// Cloudflare Worker: AI feedback proxy for TeamForge team contracts.
//
// Holds the Anthropic API key as a Worker secret so the browser never sees it.
// Validates and rate-limits requests, forwards the contract text to Claude, and
// returns structured per-section feedback. Never logs request bodies.

import Anthropic from "@anthropic-ai/sdk";
import {
  dayKey,
  hourKey,
  secondsUntilNextHour,
  validateFeedbackRequest,
  type FeedbackRequest,
} from "./limits";

export interface Env {
  ANTHROPIC_API_KEY: string;
  RATE_KV: KVNamespace;
  ALLOWED_ORIGIN: string;
  MODEL?: string;
  DAILY_CAP?: string;
  HOURLY_PER_IP?: string;
}

const FEEDBACK_SYSTEM_PROMPT = `You are a coach helping a student team sharpen its team contract before the semester begins. You are given the team's draft, section by section. For each section, give brief, concrete, kind feedback a real team could act on today.

Look especially for: rules that are vague or unenforceable ("communicate well"); missing conflict-resolution or escalation paths; commitments that are unrealistic for busy students; and norms that sound nice but say nothing. Reward specificity (named channels, concrete response times, clear what-if-you-miss-a-meeting steps).

Be encouraging and practical, not preachy. Do not invent facts about the team. Keep each field to one or two sentences.`;

const FEEDBACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall", "sections"],
  properties: {
    overall: { type: "string", description: "One short paragraph on the contract as a whole." },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "strengths", "risks", "suggestions"],
        properties: {
          id: { type: "string" },
          strengths: { type: "string" },
          risks: { type: "string" },
          suggestions: { type: "string" },
        },
      },
    },
  },
} as const;

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, env: Env, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env), ...extra },
  });
}

async function checkAndBumpLimits(env: Env, ip: string, now: Date): Promise<{ ok: boolean; retryAfter?: number }> {
  const hourlyCap = Number(env.HOURLY_PER_IP ?? "10");
  const dailyCap = Number(env.DAILY_CAP ?? "500");

  const hKey = hourKey(ip, now);
  const dKey = dayKey(now);
  const [hRaw, dRaw] = await Promise.all([env.RATE_KV.get(hKey), env.RATE_KV.get(dKey)]);
  const hCount = Number(hRaw ?? "0");
  const dCount = Number(dRaw ?? "0");

  if (hCount >= hourlyCap || dCount >= dailyCap) {
    return { ok: false, retryAfter: secondsUntilNextHour(now) };
  }
  // Bump both counters with TTLs that outlast their window.
  await Promise.all([
    env.RATE_KV.put(hKey, String(hCount + 1), { expirationTtl: 3700 }),
    env.RATE_KV.put(dKey, String(dCount + 1), { expirationTtl: 90_000 }),
  ]);
  return { ok: true };
}

async function generateFeedback(env: Env, req: FeedbackRequest): Promise<unknown> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const userText = req.sections
    .map((s) => `## ${s.title}\n${s.text.trim() || "(left blank)"}`)
    .join("\n\n");
  const preface = req.teamSize ? `This team has ${req.teamSize} members.\n\n` : "";

  const response = await client.messages.create({
    model: env.MODEL ?? "claude-sonnet-5",
    max_tokens: 4000,
    system: FEEDBACK_SYSTEM_PROMPT,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: FEEDBACK_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `${preface}Here is our team contract draft. Give feedback per section, keyed by the section id.\n\nSection ids: ${req.sections
          .map((s) => s.id)
          .join(", ")}\n\n${userText}`,
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No structured output returned.");
  return JSON.parse(textBlock.text);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/feedback") {
      return json({ error: "Not found." }, 404, env);
    }

    // CORS headers only constrain browsers; also enforce the origin server-side
    // so scripts can't spend the API key. The app always sends Origin on this
    // cross-origin POST, so requiring an exact match rejects direct clients.
    if (request.headers.get("origin") !== env.ALLOWED_ORIGIN) {
      return json({ error: "Forbidden origin." }, 403, env);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400, env);
    }
    const validated = validateFeedbackRequest(body);
    if (!validated.ok) return json({ error: validated.error }, validated.status, env);

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const now = new Date();
    const limit = await checkAndBumpLimits(env, ip, now);
    if (!limit.ok) {
      return json({ error: "Rate limit reached. Please try again later." }, 429, env, {
        "retry-after": String(limit.retryAfter ?? 3600),
      });
    }

    try {
      const feedback = await generateFeedback(env, validated.data);
      return json(feedback, 200, env);
    } catch (e) {
      // Never echo the request; log only a generic message server-side.
      console.error("feedback generation failed:", e instanceof Error ? e.message : "unknown");
      return json({ error: "Could not generate feedback right now." }, 502, env);
    }
  },
};
