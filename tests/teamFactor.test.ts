import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACTOR_PARAMS,
  computeMemberFactor,
  computeTeamFactors,
  type TeamEvalInput,
} from "../src/lib/teamFactor";
import type { PeerEvalAnswers } from "../src/types";

function submission(
  rater: number,
  points: Record<string, number>,
  behaviorRatings?: Record<string, number[]>,
): PeerEvalAnswers {
  return { round: "formative", raterCodeIndex: rater, teamLabel: "Team 1", points, justifications: {}, behaviorRatings };
}

describe("computeMemberFactor", () => {
  it("gives 1.0 for an equal split", () => {
    const r = computeMemberFactor([25, 25, 25, 25], 5, DEFAULT_FACTOR_PARAMS);
    expect(r.factor).toBe(1);
    expect(r.flags).toEqual([]);
  });

  it("uses neutral = 100/raterCount under partial submissions", () => {
    // Only 2 of 4 teammates submitted; neutral is 50.
    const r = computeMemberFactor([60, 60], 5, DEFAULT_FACTOR_PARAMS);
    expect(r.neutralShare).toBe(50);
    // < 3 ratings: no discard even on a 5-member team.
    expect(r.discardedPoint).toBeNull();
    expect(r.factor).toBeCloseTo(1.1, 10); // 1 + (0.2)/2 = 1.1, at the ceiling
  });

  it("skips the discard below five members", () => {
    const r = computeMemberFactor([40, 30, 30], 4, DEFAULT_FACTOR_PARAMS);
    expect(r.discardedPoint).toBeNull();
    expect(r.adjustedMean).toBeCloseTo(100 / 3, 10);
  });

  it("discards ties in favor of the ratee (higher rating goes)", () => {
    // Median 25; 35 and 15 are equally far -> the more favorable (35) goes.
    const r = computeMemberFactor([35, 25, 25, 15], 5, DEFAULT_FACTOR_PARAMS);
    expect(r.discardedPoint).toBe(35);
    expect(r.adjustedMean).toBeCloseTo((25 + 25 + 15) / 3, 10);
  });

  it("clamps to custom floor and ceiling", () => {
    expect(computeMemberFactor([5, 5, 5, 5], 5, { factorFloor: 0.7, factorCeiling: 1.2 }).factor).toBe(0.7);
    expect(computeMemberFactor([50, 50, 50, 40], 5, { factorFloor: 0.7, factorCeiling: 1.2 }).factor).toBe(1.2);
  });

  it("handles zero raters with a neutral factor and a flag", () => {
    const r = computeMemberFactor([], 5, DEFAULT_FACTOR_PARAMS);
    expect(r.factor).toBe(1);
    expect(r.flags).toContain("noRatings");
    expect(r.adjustedMean).toBeNull();
  });

  it("flags factors below 0.90", () => {
    const r = computeMemberFactor([20, 20, 20, 20], 5, DEFAULT_FACTOR_PARAMS);
    expect(r.factor).toBeCloseTo(0.9, 10);
    expect(r.flags).toEqual([]); // exactly 0.90 is not flagged
    const low = computeMemberFactor([19, 19, 19, 19], 5, DEFAULT_FACTOR_PARAMS);
    expect(low.flags).toContain("lowFactor");
  });
});

describe("computeTeamFactors — spreadsheet worked example", () => {
  // "Peer evaluation and team factor.xlsx": five members, one free rider.
  // Received ratings (rows) with the farthest-from-median discard:
  //   Ana  30,30,30,35 -> median 30, discard 35, mean 30,   factor 1.10
  //   Ben  28,28,27,30 -> median 28, discard 30, mean 27.7, factor 1.05
  //   Cara 30,28,28,20 -> median 28, discard 20, mean 28.7, factor 1.07
  //   Dev  27,27,27,15 -> median 27, discard 15, mean 27,   factor 1.04
  //   Eli  15,15,15,15 -> median 15, discard one, mean 15,  factor 0.80
  const team: TeamEvalInput = {
    teamLabel: "Team 1",
    memberCodeIndexes: [1, 2, 3, 4, 5], // Ana, Ben, Cara, Dev, Eli
    submissions: [
      submission(1, { "2": 28, "3": 30, "4": 27, "5": 15 }), // Ana rates others
      submission(2, { "1": 30, "3": 28, "4": 27, "5": 15 }),
      submission(3, { "1": 30, "2": 28, "4": 27, "5": 15 }),
      submission(4, { "1": 30, "2": 27, "3": 28, "5": 15 }),
      submission(5, { "1": 35, "2": 30, "3": 20, "4": 15 }), // Eli spreads oddly
    ],
  };

  it("reproduces the published factors", () => {
    const result = computeTeamFactors(team, DEFAULT_FACTOR_PARAMS);
    const byIdx = new Map(result.members.map((m) => [m.codeIndex, m]));
    expect(byIdx.get(1)!.factor).toBeCloseTo(1.1, 10);
    expect(byIdx.get(2)!.factor).toBeCloseTo(1.0533, 3);
    expect(byIdx.get(3)!.factor).toBeCloseTo(1.0733, 3);
    expect(byIdx.get(4)!.factor).toBeCloseTo(1.04, 10);
    expect(byIdx.get(5)!.factor).toBeCloseTo(0.8, 10);

    expect(byIdx.get(1)!.discardedPoint).toBe(35);
    expect(byIdx.get(2)!.adjustedMean).toBeCloseTo(27.6667, 3);
    expect(byIdx.get(3)!.adjustedMean).toBeCloseTo(28.6667, 3);

    // Eli at 0.80 vs Ana at 1.10 -> spread 0.30 > 0.25, flagged.
    expect(result.spread).toBeCloseTo(0.3, 10);
    expect(result.spreadFlagged).toBe(true);
    expect(byIdx.get(5)!.flags).toContain("lowFactor");
  });

  it("averages behavior ratings per ratee", () => {
    const withBehaviors: TeamEvalInput = {
      teamLabel: "Team 1",
      memberCodeIndexes: [1, 2, 3],
      submissions: [
        submission(1, { "2": 50, "3": 50 }, { "2": [5, 4, 4, 5], "3": [3, 3, 3, 3] }),
        submission(2, { "1": 50, "3": 50 }, { "1": [4, 4, 4, 4], "3": [5, 5, 5, 5] }),
        submission(3, { "1": 50, "2": 50 }, { "1": [2, 4, 4, 4], "2": [5, 2, 4, 5] }),
      ],
    };
    const result = computeTeamFactors(withBehaviors, DEFAULT_FACTOR_PARAMS);
    const byIdx = new Map(result.members.map((m) => [m.codeIndex, m]));
    expect(byIdx.get(1)!.behaviorAverages).toEqual([3, 4, 4, 4]);
    expect(byIdx.get(2)!.behaviorAverages).toEqual([5, 3, 4, 5]);
    expect(byIdx.get(3)!.behaviorAverages).toEqual([4, 4, 4, 4]);
  });

  it("ignores self-ratings and unknown ratees", () => {
    const sneaky: TeamEvalInput = {
      teamLabel: "Team 1",
      memberCodeIndexes: [1, 2, 3],
      submissions: [
        submission(1, { "1": 100, "2": 0, "3": 0 }), // tries to rate self
        submission(2, { "1": 50, "3": 50 }),
        submission(3, { "1": 50, "2": 50 }),
      ],
    };
    const result = computeTeamFactors(sneaky, DEFAULT_FACTOR_PARAMS);
    const one = result.members.find((m) => m.codeIndex === 1)!;
    expect(one.receivedPoints.sort()).toEqual([50, 50]); // self 100 ignored
  });
});
