import { describe, expect, it } from "vitest";
import {
  MAX_LABEL_CHARS,
  MAX_TOTAL_CHARS,
  dayKey,
  hourKey,
  secondsUntilNextDay,
  secondsUntilNextHour,
  validateFeedbackRequest,
} from "../src/limits";

describe("validateFeedbackRequest", () => {
  const good = { sections: [{ id: "communications", title: "Communications", text: "We use Slack." }] };

  it("accepts a well-formed request", () => {
    const r = validateFeedbackRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.sections).toHaveLength(1);
  });

  it("carries teamSize when numeric", () => {
    const r = validateFeedbackRequest({ ...good, teamSize: 4 });
    expect(r.ok && r.data.teamSize).toBe(4);
  });

  it("rejects non-object and empty sections", () => {
    expect(validateFeedbackRequest(null).ok).toBe(false);
    expect(validateFeedbackRequest({ sections: [] }).ok).toBe(false);
  });

  it("rejects sections missing string fields", () => {
    const r = validateFeedbackRequest({ sections: [{ id: "x", title: "X" }] });
    expect(r.ok).toBe(false);
  });

  it("rejects text over the size cap with 413", () => {
    const r = validateFeedbackRequest({
      sections: [{ id: "x", title: "X", text: "a".repeat(MAX_TOTAL_CHARS + 1) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });
});

describe("rate-limit keys", () => {
  it("builds hour and day keys in UTC", () => {
    const at = new Date(Date.UTC(2026, 7, 25, 14, 30, 0)); // 2026-08-25T14:30:00Z
    expect(hourKey("1.2.3.4", at)).toBe("rl:1.2.3.4:2026082514");
    expect(dayKey(at)).toBe("rl:global:20260825");
  });

  it("computes seconds until the next hour", () => {
    const at = new Date(Date.UTC(2026, 7, 25, 14, 30, 0));
    expect(secondsUntilNextHour(at)).toBe(1800);
  });
});

describe("label length caps", () => {
  // id and title reach the model just as text does. Budgeting only text left a
  // request that passed every check and still ran up an unbounded token bill.
  const long = "x".repeat(MAX_LABEL_CHARS + 1);

  it("rejects an over-long section title", () => {
    const r = validateFeedbackRequest({ sections: [{ id: "a", title: long, text: "hi" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects an over-long section id", () => {
    const r = validateFeedbackRequest({ sections: [{ id: long, title: "A", text: "hi" }] });
    expect(r.ok).toBe(false);
  });

  it("accepts labels at exactly the cap", () => {
    const atCap = "x".repeat(MAX_LABEL_CHARS);
    expect(validateFeedbackRequest({ sections: [{ id: atCap, title: atCap, text: "hi" }] }).ok).toBe(true);
  });

  it("counts ids and titles toward the total budget", () => {
    // 20 x 700 characters of text is 14,000 — comfortably inside the budget when
    // only text is counted, which is how it used to be. Adding the labels puts
    // the same request at 22,000 and over.
    const atCap = "x".repeat(MAX_LABEL_CHARS);
    const sections = Array.from({ length: 20 }, () => ({ id: atCap, title: atCap, text: "x".repeat(700) }));
    expect(sections.reduce((n, s) => n + s.text.length, 0)).toBeLessThan(MAX_TOTAL_CHARS);
    const r = validateFeedbackRequest({ sections });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });
});

describe("secondsUntilNextDay", () => {
  it("counts to the next UTC midnight, not the next hour", () => {
    expect(secondsUntilNextDay(new Date("2026-03-01T00:00:00Z"))).toBe(86_400);
    expect(secondsUntilNextDay(new Date("2026-03-01T23:59:00Z"))).toBe(60);
    expect(secondsUntilNextDay(new Date("2026-03-01T12:00:00Z"))).toBe(43_200);
  });

  it("is at least as long as the wait to the next hour", () => {
    const at = new Date("2026-03-01T08:17:33Z");
    expect(secondsUntilNextDay(at)).toBeGreaterThanOrEqual(secondsUntilNextHour(at));
  });
});
