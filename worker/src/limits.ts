// Pure request-validation and rate-limit helpers for the AI feedback worker.
// No Cloudflare or Anthropic imports, so these are unit-testable in plain Node.

export interface FeedbackSection {
  id: string;
  title: string;
  text: string;
}

export interface FeedbackRequest {
  sections: FeedbackSection[];
  teamSize?: number;
}

export const MAX_TOTAL_CHARS = 20_000;
export const MAX_SECTIONS = 20;
/** Ids and titles are short labels, not prose. Both are interpolated into the
 * prompt, so leaving them unbounded left a way to run up a token bill through a
 * request that passed every other check. */
export const MAX_LABEL_CHARS = 200;

export type ValidationResult =
  | { ok: true; data: FeedbackRequest }
  | { ok: false; status: number; error: string };

export function validateFeedbackRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "Body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.sections) || b.sections.length === 0) {
    return { ok: false, status: 400, error: "sections must be a non-empty array." };
  }
  if (b.sections.length > MAX_SECTIONS) {
    return { ok: false, status: 400, error: `Too many sections (max ${MAX_SECTIONS}).` };
  }
  const sections: FeedbackSection[] = [];
  let totalChars = 0;
  for (const s of b.sections) {
    if (typeof s !== "object" || s === null) {
      return { ok: false, status: 400, error: "Each section must be an object." };
    }
    const sec = s as Record<string, unknown>;
    if (typeof sec.id !== "string" || typeof sec.title !== "string" || typeof sec.text !== "string") {
      return { ok: false, status: 400, error: "Each section needs string id, title, and text." };
    }
    if (sec.id.length > MAX_LABEL_CHARS || sec.title.length > MAX_LABEL_CHARS) {
      return {
        ok: false,
        status: 400,
        error: `Section ids and titles must be ${MAX_LABEL_CHARS} characters or fewer.`,
      };
    }
    // Every field reaches the model, so every field counts toward the budget.
    totalChars += sec.text.length + sec.title.length + sec.id.length;
    sections.push({ id: sec.id, title: sec.title, text: sec.text });
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return { ok: false, status: 413, error: `Contract text is too long (max ${MAX_TOTAL_CHARS} characters).` };
  }
  const teamSize =
    typeof b.teamSize === "number" && Number.isFinite(b.teamSize) ? b.teamSize : undefined;
  return { ok: true, data: { sections, teamSize } };
}

// ---------- rate-limit key math (UTC windows) ----------

export function hourKey(ip: string, at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const h = String(at.getUTCHours()).padStart(2, "0");
  return `rl:${ip}:${y}${m}${d}${h}`;
}

export function dayKey(at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  return `rl:global:${y}${m}${d}`;
}

/** Seconds until the current UTC hour rolls over (for a Retry-After hint). */
export function secondsUntilNextHour(at: Date): number {
  return 3600 - (at.getUTCMinutes() * 60 + at.getUTCSeconds());
}

/** Seconds until the current UTC day rolls over. The daily cap is keyed to the
 * day, so pointing at the next hour would just invite a pointless retry. */
export function secondsUntilNextDay(at: Date): number {
  return 86_400 - (at.getUTCHours() * 3600 + at.getUTCMinutes() * 60 + at.getUTCSeconds());
}
