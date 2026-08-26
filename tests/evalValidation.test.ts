import { describe, expect, it } from "vitest";
import {
  evenSplit,
  justificationApplies,
  needsJustification,
  neutralRange,
  pruneJustifications,
  validatePeerEval,
} from "../src/lib/evalValidation";
import type { PeerEvalAnswers } from "../src/types";

const CONFIG = { includeBehaviors: false, behaviorCount: 4 };
const BEHAVIOR_CONFIG = { includeBehaviors: true, behaviorCount: 4 };

function answers(overrides: Partial<PeerEvalAnswers>): PeerEvalAnswers {
  return {
    round: "formative",
    raterCodeIndex: 1,
    teamLabel: "Team 1",
    points: {},
    justifications: {},
    ...overrides,
  };
}

describe("neutralRange", () => {
  it("scales with team size instead of using fixed point thresholds", () => {
    expect(neutralRange(4)).toEqual({ neutral: 25, low: 23, high: 27 });
    expect(neutralRange(3)).toEqual({ neutral: 100 / 3, low: 31, high: 36 });
    expect(neutralRange(2)).toEqual({ neutral: 50, low: 46, high: 54 });
  });

  it("widens to admit the even split when the band is narrower than a point", () => {
    // 11 teammates: neutral 9.09, so a purely relative band gives 9-9. But 100
    // does not divide by 11 -- somebody must get 10. Before the floor/ceil
    // guard the form opened demanding a justification for that rounding.
    expect(neutralRange(11)).toEqual({ neutral: 100 / 11, low: 9, high: 10 });
    expect(needsJustification(10, 11)).toBe(false);

    // Sizes where the relative band is already wide enough are untouched.
    expect(neutralRange(4)).toEqual({ neutral: 25, low: 23, high: 27 });
    expect(neutralRange(7)).toEqual({ neutral: 100 / 7, low: 14, high: 15 });
  });

  it("leaves the pre-filled even split inside the band despite rounding", () => {
    // splitEvenly hands out 34/33/33 across three teammates; neither value may
    // demand a justification for arithmetic nobody chose.
    const { low, high } = neutralRange(3);
    for (const v of [34, 33]) {
      expect(v).toBeGreaterThanOrEqual(low);
      expect(v).toBeLessThanOrEqual(high);
    }
  });
});

describe("validatePeerEval", () => {
  const teammates = [2, 3, 4, 5]; // 4 raters -> neutral 25, band 23..27

  it("accepts an equal split without justification", () => {
    expect(validatePeerEval(answers({ points: { "2": 25, "3": 25, "4": 25, "5": 25 } }), teammates, CONFIG)).toEqual([]);
  });

  it("rejects totals that are not 100", () => {
    const p = validatePeerEval(answers({ points: { "2": 25, "3": 25, "4": 25, "5": 30 } }), teammates, CONFIG);
    expect(p.join(" ")).toMatch(/sum to exactly 100/);
  });

  it("rejects negative and non-integer points", () => {
    const p = validatePeerEval(answers({ points: { "2": -5, "3": 40.5, "4": 40, "5": 24.5 } }), teammates, CONFIG);
    expect(p.join(" ")).toMatch(/whole number/);
    expect(p.join(" ")).toMatch(/between 0 and 100/);
  });

  it("requires a justification for any allocation outside the dead band", () => {
    // 23..27 passes silently; 22 and 28 do not.
    const inside = validatePeerEval(
      answers({ points: { "2": 27, "3": 25, "4": 25, "5": 23 } }),
      teammates,
      CONFIG,
    );
    expect(inside).toEqual([]);

    const low = validatePeerEval(answers({ points: { "2": 22, "3": 26, "4": 26, "5": 26 } }), teammates, CONFIG);
    expect(low.join(" ")).toMatch(/justification/);

    const high = validatePeerEval(answers({ points: { "2": 28, "3": 24, "4": 24, "5": 24 } }), teammates, CONFIG);
    expect(high.join(" ")).toMatch(/justification/);

    const justified = validatePeerEval(
      answers({
        points: { "2": 22, "3": 26, "4": 26, "5": 26 },
        justifications: { "2": "Missed all three milestone meetings." },
      }),
      teammates,
      CONFIG,
    );
    expect(justified).toEqual([]);
  });

  it("names the allowed range in the message", () => {
    const p = validatePeerEval(answers({ points: { "2": 0, "3": 34, "4": 33, "5": 33 } }), teammates, CONFIG);
    expect(p.join(" ")).toMatch(/outside 23-27/);
  });

  it("no longer exempts trios, the most gameable size", () => {
    // Two members of a trio giving each other everything used to sail through
    // with no justification at all.
    expect(justificationApplies(2)).toBe(true);
    const p = validatePeerEval(answers({ points: { "2": 100, "3": 0 } }), [2, 3], CONFIG);
    expect(p.join(" ")).toMatch(/justification/);
    expect(validatePeerEval(answers({ points: { "2": 50, "3": 50 } }), [2, 3], CONFIG)).toEqual([]);
  });

  it("waives the rule only for a pair, where 100 is the sole honest answer", () => {
    expect(justificationApplies(1)).toBe(false);
    expect(validatePeerEval(answers({ points: { "2": 100 } }), [2], CONFIG)).toEqual([]);
  });

  it("keeps applying to large teams, which the old thresholds skipped", () => {
    expect(justificationApplies(7)).toBe(true);
    expect(needsJustification(14, 7)).toBe(false); // neutral 14.29, band 14..15
    expect(needsJustification(20, 7)).toBe(true);
  });

  it("respects a session-configured dead band", () => {
    // A wider band tolerates more before demanding text.
    expect(needsJustification(20, 4, 0.08)).toBe(true);
    expect(needsJustification(20, 4, 0.25)).toBe(false);
    const p = validatePeerEval(
      answers({ points: { "2": 20, "3": 27, "4": 27, "5": 26 } }),
      teammates,
      { ...CONFIG, deadband: 0.25 },
    );
    expect(p).toEqual([]);
  });

  it("rejects allocations to non-teammates and missing teammates", () => {
    const stranger = validatePeerEval(
      answers({ points: { "2": 25, "3": 25, "4": 25, "5": 25, "9": 0 } }),
      teammates,
      CONFIG,
    );
    expect(stranger.join(" ")).toMatch(/not a teammate/);

    const missing = validatePeerEval(answers({ points: { "2": 50, "3": 50 } }), teammates, CONFIG);
    expect(missing.join(" ")).toMatch(/Missing a point allocation/);
  });

  it("checks the behavior matrix only when enabled", () => {
    const noBehaviors = answers({ points: { "2": 25, "3": 25, "4": 25, "5": 25 } });
    expect(validatePeerEval(noBehaviors, teammates, CONFIG)).toEqual([]);

    const p = validatePeerEval(noBehaviors, teammates, BEHAVIOR_CONFIG);
    expect(p.join(" ")).toMatch(/behavior ratings/i);

    const complete = answers({
      points: { "2": 25, "3": 25, "4": 25, "5": 25 },
      behaviorRatings: { "2": [1, 2, 3, 4], "3": [5, 5, 5, 5], "4": [3, 3, 3, 3], "5": [4, 4, 4, 4] },
    });
    expect(validatePeerEval(complete, teammates, BEHAVIOR_CONFIG)).toEqual([]);

    const outOfRange = answers({
      points: { "2": 25, "3": 25, "4": 25, "5": 25 },
      behaviorRatings: { "2": [0, 2, 3, 4], "3": [5, 5, 5, 6], "4": [3, 3, 3, 3], "5": [4, 4, 4, 4] },
    });
    expect(validatePeerEval(outOfRange, teammates, BEHAVIOR_CONFIG).join(" ")).toMatch(/1 to 5/);
  });
});

describe("pruneJustifications", () => {
  const teammates = [2, 3, 4, 5]; // neutral 25, band 23..27

  it("drops text left behind when an allocation moves back inside the band", () => {
    // The regression: a student writes a justification for 20, then revises to
    // 25. The field disappears from the form but the sentence was still
    // submitted, and showed up in the instructor's detail CSV as though it
    // described the final answer.
    const pruned = pruneJustifications(
      { "2": 25, "3": 25, "4": 25, "5": 25 },
      { "2": "Missed every meeting." },
      teammates,
    );
    expect(pruned).toEqual({});
  });

  it("keeps the justification an out-of-band allocation still needs", () => {
    const pruned = pruneJustifications(
      { "2": 20, "3": 27, "4": 27, "5": 26 },
      { "2": "Missed every meeting." },
      teammates,
    );
    expect(pruned).toEqual({ "2": "Missed every meeting." });
  });

  it("prunes per teammate, not all-or-nothing", () => {
    const pruned = pruneJustifications(
      { "2": 10, "3": 40, "4": 25, "5": 25 },
      { "2": "Did nothing.", "3": "Did everything.", "4": "stale", "5": "  " },
      teammates,
    );
    expect(pruned).toEqual({ "2": "Did nothing.", "3": "Did everything." });
  });

  it("trims surrounding whitespace and drops blank text", () => {
    const pruned = pruneJustifications(
      { "2": 20, "3": 27, "4": 27, "5": 26 },
      { "2": "  Carried by the team.  ", "3": "   " },
      teammates,
    );
    expect(pruned).toEqual({ "2": "Carried by the team." });
  });

  it("respects a session-configured dead band", () => {
    const points = { "2": 20, "3": 27, "4": 27, "5": 26 };
    const j = { "2": "Below the default band." };
    expect(pruneJustifications(points, j, teammates, 0.08)).toEqual(j);
    // A wider band makes 20 unremarkable, so the sentence is no longer needed.
    expect(pruneJustifications(points, j, teammates, 0.25)).toEqual({});
  });

  it("ignores entries for anyone who is not a teammate", () => {
    const pruned = pruneJustifications(
      { "2": 10, "3": 30, "4": 30, "5": 30 },
      { "2": "Kept.", "9": "Not on this team." },
      teammates,
    );
    expect(pruned).toEqual({ "2": "Kept." });
  });

  it("leaves a validated submission untouched", () => {
    // Whatever survives pruning must still satisfy the validator, or a student
    // could be blocked by a field the form no longer shows them.
    const points = { "2": 20, "3": 27, "4": 27, "5": 26 };
    const justifications = pruneJustifications(points, { "2": "Absent throughout." }, teammates);
    expect(justifications).toEqual({ "2": "Absent throughout." });
    expect(
      validatePeerEval(answers({ points, justifications }), teammates, CONFIG),
    ).toEqual([]);
  });

  it("a deep cut pulls everyone else out of the band too", () => {
    // Not a quirk — the 100 points have to land somewhere. Taking 15 off one
    // teammate lifts the other three to 30, past the band, so every allocation
    // on the ballot now needs a sentence. That is the friction a group has to
    // accept before they can agree to mark somebody down.
    const points = { "2": 10, "3": 30, "4": 30, "5": 30 };
    const problems = validatePeerEval(answers({ points }), teammates, CONFIG);
    expect(problems).toHaveLength(4);
    expect(pruneJustifications(points, { "2": "a", "3": "b", "4": "c", "5": "d" }, teammates)).toEqual({
      "2": "a",
      "3": "b",
      "4": "c",
      "5": "d",
    });
  });
});

describe("evenSplit", () => {
  it("always totals exactly 100", () => {
    for (let n = 1; n <= 12; n++) {
      const split = evenSplit(Array.from({ length: n }, (_, i) => i + 2));
      expect(Object.values(split).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("hands the remainder out one point at a time", () => {
    expect(evenSplit([2, 3, 4])).toEqual({ "2": 34, "3": 33, "4": 33 });
    expect(evenSplit([2, 3, 4, 5])).toEqual({ "2": 25, "3": 25, "4": 25, "5": 25 });
    expect(evenSplit([2, 3])).toEqual({ "2": 50, "3": 50 });
  });

  it("never demands a justification for itself", () => {
    // The form opens on this split. If any team size produced a default that
    // fell outside its own dead band, students would be asked to explain an
    // allocation they never chose -- and every ballot would start invalid.
    for (let n = 1; n <= 12; n++) {
      const teammates = Array.from({ length: n }, (_, i) => i + 2);
      const split = evenSplit(teammates);
      for (const [idx, points] of Object.entries(split)) {
        expect(
          needsJustification(points, n),
          `team size ${n}: default of ${points} for #${idx} would need a justification`,
        ).toBe(false);
      }
    }
  });

  it("opens the form in a state that already validates", () => {
    for (let n = 2; n <= 8; n++) {
      const teammates = Array.from({ length: n }, (_, i) => i + 2);
      const problems = validatePeerEval(
        answers({ points: evenSplit(teammates) }),
        teammates,
        CONFIG,
      );
      expect(problems, `team size ${n}`).toEqual([]);
    }
  });
});
