import { describe, expect, it } from "vitest";
import {
  justificationApplies,
  needsJustification,
  neutralRange,
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
