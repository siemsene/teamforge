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
    totalChars += sec.text.length;
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
