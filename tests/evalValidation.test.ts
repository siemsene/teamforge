import { describe, expect, it } from "vitest";
import { justificationApplies, needsJustification, validatePeerEval } from "../src/lib/evalValidation";
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

describe("validatePeerEval", () => {
  const teammates = [2, 3, 4, 5]; // 4 raters -> neutral 25, thresholds apply

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

  it("requires a justification exactly below 15 and above 40", () => {
    const low = validatePeerEval(answers({ points: { "2": 14, "3": 30, "4": 30, "5": 26 } }), teammates, CONFIG);
    expect(low.join(" ")).toMatch(/justification/);

    const high = validatePeerEval(answers({ points: { "2": 41, "3": 20, "4": 20, "5": 19 } }), teammates, CONFIG);
    expect(high.join(" ")).toMatch(/justification/);

    const boundary = validatePeerEval(answers({ points: { "2": 15, "3": 40, "4": 25, "5": 20 } }), teammates, CONFIG);
    expect(boundary).toEqual([]);

    const justified = validatePeerEval(
      answers({
        points: { "2": 14, "3": 30, "4": 30, "5": 26 },
        justifications: { "2": "Missed all three milestone meetings." },
      }),
      teammates,
      CONFIG,
    );
    expect(justified).toEqual([]);
  });

  it("waives justification thresholds when the neutral share lies outside [15, 40]", () => {
    // Pair: one teammate, neutral 100.
    expect(justificationApplies(1)).toBe(false);
    expect(validatePeerEval(answers({ points: { "2": 100 } }), [2], CONFIG)).toEqual([]);
    // Trio: neutral 50.
    expect(justificationApplies(2)).toBe(false);
    expect(validatePeerEval(answers({ points: { "2": 55, "3": 45 } }), [2, 3], CONFIG)).toEqual([]);
    // Large team: 7 teammates, neutral ~14.3.
    expect(justificationApplies(7)).toBe(false);
    // Standard sizes apply.
    expect(justificationApplies(3)).toBe(true);
    expect(justificationApplies(4)).toBe(true);
    expect(needsJustification(14, 4)).toBe(true);
    expect(needsJustification(25, 4)).toBe(false);
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
