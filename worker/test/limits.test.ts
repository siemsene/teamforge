import { describe, expect, it } from "vitest";
import {
  MAX_TOTAL_CHARS,
  dayKey,
  hourKey,
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
