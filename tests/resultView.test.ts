import { describe, expect, it } from "vitest";
import {
  behaviourScores,
  factorEffect,
  factorMeaning,
  gaugePercent,
} from "../src/features/student/resultView";

const LABELS = ["Did what they said", "Raised problems early", "Made others better", "Would pick again"];

describe("behaviourScores", () => {
  it("pairs each average with the behaviour it measures", () => {
    // The whole point: an array of averages says nothing about which is which.
    expect(behaviourScores([4.7, 4.2], ["Kept commitments", "Flagged risks"], LABELS)).toEqual([
      { label: "Kept commitments", average: 4.7 },
      { label: "Flagged risks", average: 4.2 },
    ]);
  });

  it("prefers the labels stored with the result over the current config", () => {
    // An instructor editing the behaviour list must not silently re-label
    // results that were already published under the old wording.
    const stored = ["Old wording A", "Old wording B", "Old wording C", "Old wording D"];
    expect(behaviourScores([1, 2, 3, 4], stored, LABELS).map((s) => s.label)).toEqual(stored);
  });

  it("falls back to config labels for results published before labels were stored", () => {
    expect(behaviourScores([1, 2, 3, 4], undefined, LABELS).map((s) => s.label)).toEqual(LABELS);
  });

  it("falls back to a placeholder rather than risk a wrong label", () => {
    // A mismatched count means the lists cannot be aligned; a number under the
    // wrong heading is worse than a number under a generic one.
    expect(behaviourScores([1, 2, 3], ["only", "two"], []).map((s) => s.label)).toEqual([
      "Behaviour 1",
      "Behaviour 2",
      "Behaviour 3",
    ]);
    expect(behaviourScores([1, 2, 3], ["only", "two"], LABELS).map((s) => s.label)).toEqual(
      LABELS.slice(0, 3),
    );
  });

  it("returns nothing when there are no averages to show", () => {
    expect(behaviourScores(undefined, LABELS, LABELS)).toEqual([]);
    expect(behaviourScores([], LABELS, LABELS)).toEqual([]);
  });
});

describe("gaugePercent", () => {
  it("places the ends of the range at the ends of the bar", () => {
    expect(gaugePercent(0.7, 0.7, 1.05)).toBe(0);
    expect(gaugePercent(1.05, 0.7, 1.05)).toBe(100);
  });

  it("puts 1.00 where it actually falls, not at the midpoint", () => {
    // The range is deliberately asymmetric, so an even share sits well right of
    // centre. Drawing it centred would misstate what the student is looking at.
    expect(gaugePercent(1, 0.7, 1.05)).toBeCloseTo(85.71, 2);
    expect(gaugePercent(1, 0.8, 1.1)).toBeCloseTo(66.67, 2);
    expect(gaugePercent(1, 0.5, 1.5)).toBe(50); // symmetric range, centred
  });

  it("clamps anything outside the range", () => {
    expect(gaugePercent(0.1, 0.7, 1.05)).toBe(0);
    expect(gaugePercent(9, 0.7, 1.05)).toBe(100);
  });

  it("survives a degenerate range instead of dividing by zero", () => {
    expect(gaugePercent(1, 1, 1)).toBe(50);
    expect(gaugePercent(1, 1.2, 0.8)).toBe(50);
  });
});

describe("factorMeaning", () => {
  it("distinguishes the three cases without editorialising", () => {
    expect(factorMeaning(1)).toMatch(/An even share/);
    expect(factorMeaning(1.05)).toMatch(/Above an even share/);
    expect(factorMeaning(0.84)).toMatch(/Below an even share/);
  });
});

describe("factorEffect", () => {
  it("states the effect on the grade in the student's own terms", () => {
    expect(factorEffect(1)).toMatch(/unchanged/);
    expect(factorEffect(1.05)).toBe("It raises the team-scored part of your grade by 5%.");
    expect(factorEffect(0.84)).toBe("It lowers the team-scored part of your grade by 16%.");
  });

  it("keeps one decimal where the factor has one", () => {
    expect(factorEffect(1.025)).toBe("It raises the team-scored part of your grade by 2.5%.");
  });

  it("does not let floating-point noise leak into the sentence", () => {
    // 0.84 - 1 is -0.16000000000000003 in binary floating point.
    expect(factorEffect(0.84)).not.toMatch(/\d\.\d{3}/);
    expect(factorEffect(0.7)).toBe("It lowers the team-scored part of your grade by 30%.");
  });
});
