import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACTOR_PARAMS,
  MIN_RATERS_FOR_DETAIL,
  MIN_RATERS_TO_PUBLISH,
  MIN_RATERS_TO_TRIM,
  computeTeamFactors,
  maxTeamSizeForNegativeSum,
  scapegoatingIsNegativeSum,
  neutralShare,
  resolveFactorParams,
  shareToFactor,
  trimEnds,
  type TeamEvalInput,
} from "../src/lib/teamFactor";
import { neutralRange } from "../src/lib/evalValidation";
import type { PeerEvalAnswers } from "../src/types";

const P = DEFAULT_FACTOR_PARAMS;

function submission(
  rater: number,
  points: Record<string, number>,
  behaviorRatings?: Record<string, number[]>,
): PeerEvalAnswers {
  return {
    round: "formative",
    raterCodeIndex: rater,
    teamLabel: "Team 1",
    points,
    justifications: {},
    behaviorRatings,
  };
}

/** Builds a team where `ballots[rater]` is that member's allocation; a member
 * absent from `ballots` did not submit. */
function team(size: number, ballots: Record<number, Record<string, number>>): TeamEvalInput {
  const memberCodeIndexes = Array.from({ length: size }, (_, i) => i + 1);
  return {
    teamLabel: "Team 1",
    memberCodeIndexes,
    submissions: Object.entries(ballots).map(([r, pts]) => submission(Number(r), pts)),
  };
}

/** An even split of 100 across everyone but `self`, as the form pre-fills it. */
function even(size: number, self: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 1; i <= size; i++) if (i !== self) out[String(i)] = 100 / (size - 1);
  return out;
}

function evenTeam(size: number, omit: number[] = []): TeamEvalInput {
  const ballots: Record<number, Record<string, number>> = {};
  for (let i = 1; i <= size; i++) if (!omit.includes(i)) ballots[i] = even(size, i);
  return team(size, ballots);
}

function factors(t: TeamEvalInput, params = P): number[] {
  return computeTeamFactors(t, params).members.map((m) => m.factor);
}

describe("shareToFactor", () => {
  it("maps anything inside the dead band to exactly 1", () => {
    for (const s of [0.92, 0.95, 1, 1.05, 1.08]) expect(shareToFactor(s, P)).toBe(1);
  });

  it("damps the deviation beyond the dead band", () => {
    // d = 0.28, beyond = 0.20, damped by 0.5 -> 1.10, capped at 1.05.
    expect(shareToFactor(1.28, P)).toBe(1.05);
    // d = -0.28, beyond = 0.20 -> 0.90, inside the floor.
    expect(shareToFactor(0.72, P)).toBeCloseTo(0.9, 10);
  });

  it("clips asymmetrically, so losses run deeper than gains", () => {
    expect(shareToFactor(5, P)).toBe(1.05);
    expect(shareToFactor(0, P)).toBe(0.7);
  });

  it("honours custom parameters", () => {
    const loose = { factorFloor: 0.5, factorCeiling: 1.5, deadband: 0, damping: 1 };
    expect(shareToFactor(1.2, loose)).toBeCloseTo(1.2, 10);
    expect(shareToFactor(0.8, loose)).toBeCloseTo(0.8, 10);
  });
});

describe("trimEnds", () => {
  const real = (...s: number[]) => s.map((share) => ({ share, imputed: false }));

  it("drops the highest and the lowest", () => {
    const r = trimEnds(real(0.5, 1, 1, 2));
    expect(r.trimmedLow).toBe(0.5);
    expect(r.trimmedHigh).toBe(2);
    expect(r.kept.map((k) => k.share)).toEqual([1, 1]);
  });

  it("leaves the median at exactly the trim threshold", () => {
    expect(MIN_RATERS_TO_TRIM).toBe(3);
    const r = trimEnds(real(0, 1, 1.5));
    expect(r.kept.map((k) => k.share)).toEqual([1]);
  });

  it("skips the trim below the threshold", () => {
    const r = trimEnds(real(0, 2));
    expect(r.trimmedLow).toBeNull();
    expect(r.kept).toHaveLength(2);
  });

  it("never trims an imputed share, and keeps it in the mean", () => {
    const mixed = [...real(0.5, 1, 2), { share: 1, imputed: true }];
    const r = trimEnds(mixed);
    expect(r.trimmedLow).toBe(0.5);
    expect(r.trimmedHigh).toBe(2);
    expect(r.kept.filter((k) => k.imputed)).toHaveLength(1);
    expect(r.kept.map((k) => k.share).sort()).toEqual([1, 1]);
  });

  it("counts only real shares toward the threshold", () => {
    const mostlyImputed = [
      ...real(0, 2),
      { share: 1, imputed: true },
      { share: 1, imputed: true },
    ];
    expect(trimEnds(mostlyImputed).trimmedLow).toBeNull();
  });
});

describe("computeTeamFactors — the scenarios the design was verified against", () => {
  it("gives everyone 1.00 for an honest even split", () => {
    const r = computeTeamFactors(evenTeam(5), P);
    expect(r.members.map((m) => m.factor)).toEqual([1, 1, 1, 1, 1]);
    expect(r.teamMean).toBe(1);
    expect(r.spreadFlagged).toBe(false);
    expect(r.members.every((m) => m.flags.length === 0)).toBe(true);
  });

  it("absorbs honest noise inside the dead band", () => {
    const t = team(5, {
      1: { "2": 27, "3": 25, "4": 25, "5": 23 },
      2: { "1": 26, "3": 24, "4": 25, "5": 25 },
      3: { "1": 25, "2": 26, "4": 24, "5": 25 },
      4: { "1": 25, "2": 25, "3": 27, "5": 23 },
      5: { "1": 27, "2": 25, "3": 25, "4": 23 },
    });
    expect(factors(t)).toEqual([1, 1, 1, 1, 1]);
    expect(computeTeamFactors(t, P).teamMean).toBe(1);
  });

  it("neutralises a non-submitter instead of rewarding them", () => {
    const r = computeTeamFactors(evenTeam(5, [5]), P);
    expect(r.members.map((m) => m.factor)).toEqual([1, 1, 1, 1, 1]);
    expect(r.teamMean).toBe(1);

    const silent = r.members.find((m) => m.codeIndex === 5)!;
    expect(silent.flags).toContain("noSubmission");
    expect(silent.raterCount).toBe(4);
    expect(silent.imputedCount).toBe(0);

    const other = r.members.find((m) => m.codeIndex === 1)!;
    expect(other.flags).not.toContain("noSubmission");
    expect(other.raterCount).toBe(3); // real raters only — gates the k>=3 guard
    expect(other.imputedCount).toBe(1);
  });

  it("stays neutral when nobody submits at all", () => {
    const r = computeTeamFactors(evenTeam(5, [1, 2, 3, 4, 5]), P);
    expect(r.members.map((m) => m.factor)).toEqual([1, 1, 1, 1, 1]);
    expect(r.teamMean).toBe(1);
    expect(r.members.every((m) => m.raterCount === 0)).toBe(true);
  });

  it("neutralises a lone hostile rater on a team of five", () => {
    const t = team(5, {
      1: even(5, 1),
      2: even(5, 2),
      3: even(5, 3),
      4: even(5, 4),
      5: { "1": 0, "2": 100 / 3, "3": 100 / 3, "4": 100 / 3 },
    });
    expect(factors(t)).toEqual([1, 1, 1, 1, 1]);
  });

  it("neutralises a lone hostile rater on a team of four", () => {
    // The old farthest-from-median rule skipped teams under five entirely,
    // leaving the target at 0.873.
    const t = team(4, {
      1: even(4, 1),
      2: even(4, 2),
      3: even(4, 3),
      4: { "1": 0, "2": 50, "3": 50 },
    });
    expect(factors(t)).toEqual([1, 1, 1, 1]);
  });

  it("neutralises a lone generous rater, which the old rule let through", () => {
    const t = team(4, {
      1: even(4, 1),
      2: even(4, 2),
      3: even(4, 3),
      4: { "1": 100, "2": 0, "3": 0 },
    });
    expect(factors(t)).toEqual([1, 1, 1, 1]);
  });

  it("marks down a genuine free rider", () => {
    const t = team(5, {
      1: { "2": 30, "3": 30, "4": 30, "5": 10 },
      2: { "1": 30, "3": 30, "4": 30, "5": 10 },
      3: { "1": 30, "2": 30, "4": 30, "5": 10 },
      4: { "1": 30, "2": 30, "3": 30, "5": 10 },
      5: even(5, 5),
    });
    const r = computeTeamFactors(t, P);
    const by = new Map(r.members.map((m) => [m.codeIndex, m]));
    for (const i of [1, 2, 3, 4]) expect(by.get(i)!.factor).toBeCloseTo(1.05, 10);
    expect(by.get(5)!.factor).toBeCloseTo(0.74, 10);
    expect(by.get(5)!.flags).toContain("lowFactor");
    expect(r.teamMean).toBeCloseTo(0.988, 10);
    expect(r.spreadFlagged).toBe(true);
  });

  it("makes the scapegoat cartel negative-sum", () => {
    // Four members agree to give the fifth nothing and split over each other.
    const t3 = 100 / 3;
    const dump = (self: number) => {
      const out: Record<string, number> = { "5": 0 };
      for (let i = 1; i <= 4; i++) if (i !== self) out[String(i)] = t3;
      return out;
    };
    const t = team(5, { 1: dump(1), 2: dump(2), 3: dump(3), 4: dump(4), 5: even(5, 5) });
    const r = computeTeamFactors(t, P);
    const by = new Map(r.members.map((m) => [m.codeIndex, m]));

    // Each colluder gains 0.05; the victim loses 0.30. Under the old algorithm
    // they gained 0.10 each and the team mean rose to 1.04.
    for (const i of [1, 2, 3, 4]) expect(by.get(i)!.factor).toBeCloseTo(1.05, 10);
    expect(by.get(5)!.factor).toBe(0.7);
    expect(r.teamMean).toBeCloseTo(0.98, 10);
    expect(r.teamMean).toBeLessThan(1);

    expect(by.get(5)!.flags).toContain("unanimousLow");
    expect(by.get(1)!.flags).not.toContain("unanimousLow");
  });

  it("halves the trio cartel payoff but cannot remove it", () => {
    // Two of three can still reach the ceiling: with only two raters each there
    // is nothing to trim. The floor bounds the damage and the justification
    // rule (see evalValidation) is what makes the play costly.
    const t = team(3, { 1: { "2": 100, "3": 0 }, 2: { "1": 100, "3": 0 }, 3: { "1": 50, "2": 50 } });
    const r = computeTeamFactors(t, P);
    expect(r.members.map((m) => m.factor)).toEqual([1.05, 1.05, 0.7]);
    expect(r.teamMean).toBeCloseTo(0.9333, 4);
  });

  it("does not flag a scattered low rating as unanimous", () => {
    const t = team(5, {
      1: { "2": 30, "3": 30, "4": 28, "5": 12 },
      2: { "1": 32, "3": 30, "4": 30, "5": 8 },
      3: { "1": 30, "2": 32, "4": 20, "5": 18 },
      4: { "1": 30, "2": 30, "3": 30, "5": 10 },
      5: even(5, 5),
    });
    const five = computeTeamFactors(t, P).members.find((m) => m.codeIndex === 5)!;
    expect(five.flags).toContain("lowFactor");
    expect(five.flags).not.toContain("unanimousLow");
  });
});

describe("the published worked example", () => {
  // Mirrors scripts/worked-example.ts, which regenerates the numbers printed in
  // "Peer evaluation and team factor.xlsx". Students are told they can check the
  // arithmetic against that sheet, so the sheet and the code must not drift.
  const NAMES = ["Ana", "Ben", "Cara", "Dev", "Eli"];
  const idx = (n: string) => NAMES.indexOf(n) + 1;
  const ballots: Record<string, Record<string, number>> = {
    Ana: { Ben: 28, Cara: 30, Dev: 27, Eli: 15 },
    Ben: { Ana: 30, Cara: 28, Dev: 27, Eli: 15 },
    Cara: { Ana: 30, Ben: 28, Dev: 27, Eli: 15 },
    Dev: { Ana: 30, Ben: 27, Cara: 28, Eli: 15 },
    Eli: { Ana: 35, Ben: 30, Cara: 20, Dev: 15 }, // rates oddly in both directions
  };
  const worked = team(
    5,
    Object.fromEntries(
      Object.entries(ballots).map(([rater, pts]) => [
        idx(rater),
        Object.fromEntries(Object.entries(pts).map(([n, v]) => [String(idx(n)), v])),
      ]),
    ),
  );

  it("reproduces the published factors", () => {
    const r = computeTeamFactors(worked, P);
    const by = new Map(r.members.map((m) => [NAMES[m.codeIndex - 1], m]));
    expect(by.get("Ana")!.factor).toBeCloseTo(1.05, 10);
    expect(by.get("Ben")!.factor).toBeCloseTo(1.02, 10);
    expect(by.get("Cara")!.factor).toBeCloseTo(1.02, 10);
    expect(by.get("Dev")!.factor).toBeCloseTo(1.0, 10);
    expect(by.get("Eli")!.factor).toBeCloseTo(0.84, 10);
    expect(r.teamMean).toBeCloseTo(0.986, 10);
    expect(r.spread).toBeCloseTo(0.21, 10);
    expect(r.spreadFlagged).toBe(true);
  });

  it("cancels Eli's outlying ratings in both directions", () => {
    const by = new Map(
      computeTeamFactors(worked, P).members.map((m) => [NAMES[m.codeIndex - 1], m]),
    );
    // Eli inflated Ana to 35 (share 1.40) — trimmed off the top.
    expect(by.get("Ana")!.trimmedHigh).toBeCloseTo(1.4, 10);
    // Eli gave Dev 15 (share 0.60) — trimmed off the bottom, restoring 1.00.
    expect(by.get("Dev")!.trimmedLow).toBeCloseTo(0.6, 10);
    expect(by.get("Dev")!.factor).toBe(1);
  });

  it("matches the workbook when Eli does not submit", () => {
    // The imputation branch of public/peer-eval-team-factor.xlsx. Blanking a
    // ballot row there must produce these same figures — verified by evaluating
    // the sheet, so the published calculator cannot drift from the code.
    const silent = team(
      5,
      Object.fromEntries(
        Object.entries(ballots)
          .filter(([rater]) => rater !== "Eli")
          .map(([rater, pts]) => [
            idx(rater),
            Object.fromEntries(Object.entries(pts).map(([n, v]) => [String(idx(n)), v])),
          ]),
      ),
    );
    const r = computeTeamFactors(silent, P);
    const by = new Map(r.members.map((m) => [NAMES[m.codeIndex - 1], m]));
    expect(by.get("Ana")!.factor).toBeCloseTo(1.01, 10);
    expect(by.get("Ben")!.factor).toBe(1);
    expect(by.get("Cara")!.factor).toBe(1);
    expect(by.get("Dev")!.factor).toBe(1);
    expect(by.get("Eli")!.factor).toBeCloseTo(0.84, 10);
    expect(by.get("Ana")!.imputedCount).toBe(1);
    expect(by.get("Eli")!.flags).toContain("noSubmission");
    expect(r.teamMean).toBeCloseTo(0.97, 10);
  });

  it("flags the free rider as unanimously low", () => {
    const eli = computeTeamFactors(worked, P).members.find((m) => m.codeIndex === idx("Eli"))!;
    expect(eli.flags).toContain("lowFactor");
    expect(eli.flags).toContain("unanimousLow");
  });
});

describe("computeTeamFactors — bookkeeping", () => {
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
    const one = computeTeamFactors(sneaky, P).members.find((m) => m.codeIndex === 1)!;
    expect(one.receivedPoints.sort()).toEqual([50, 50]); // self 100 ignored
    expect(one.factor).toBe(1);
  });

  it("imputes for a ballot that omits one ratee", () => {
    const partial: TeamEvalInput = {
      teamLabel: "Team 1",
      memberCodeIndexes: [1, 2, 3, 4],
      submissions: [
        submission(1, { "2": 50, "3": 50 }), // no allocation for 4
        submission(2, even(4, 2)),
        submission(3, even(4, 3)),
        submission(4, even(4, 4)),
      ],
    };
    const four = computeTeamFactors(partial, P).members.find((m) => m.codeIndex === 4)!;
    expect(four.imputedCount).toBe(1);
    expect(four.raterCount).toBe(2);
    expect(four.receivedShares).toHaveLength(3);
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
    const by = new Map(computeTeamFactors(withBehaviors, P).members.map((m) => [m.codeIndex, m]));
    expect(by.get(1)!.behaviorAverages).toEqual([3, 4, 4, 4]);
    expect(by.get(2)!.behaviorAverages).toEqual([5, 3, 4, 5]);
    expect(by.get(3)!.behaviorAverages).toEqual([4, 4, 4, 4]);
  });

  it("reports the shares it trimmed", () => {
    const t = team(5, {
      1: even(5, 1),
      2: even(5, 2),
      3: even(5, 3),
      4: even(5, 4),
      5: { "1": 10, "2": 30, "3": 30, "4": 30 },
    });
    const one = computeTeamFactors(t, P).members.find((m) => m.codeIndex === 1)!;
    expect(one.trimmedLow).toBeCloseTo(0.4, 10); // 10 / 25
    expect(one.trimmedHigh).toBe(1);
    expect(one.share).toBe(1);
    expect(one.neutralShare).toBe(25);
  });

  it("keeps working on configs written before the dead band existed", () => {
    const params = resolveFactorParams({ factorFloor: 0.8, factorCeiling: 1.1 });
    expect(params).toEqual({ factorFloor: 0.8, factorCeiling: 1.1, deadband: 0.08, damping: 0.5 });
    expect(factors(evenTeam(5), params)).toEqual([1, 1, 1, 1, 1]);
  });

  it("handles a pair, where nothing can be trimmed or gamed", () => {
    expect(neutralShare(2)).toBe(100);
    expect(factors(team(2, { 1: { "2": 100 }, 2: { "1": 100 } }))).toEqual([1, 1]);
  });
});

describe("team mean", () => {
  it("is exactly 1 whenever a team has no dispersion beyond the dead band", () => {
    // Randomised even-ish teams: every allocation stays inside the band, so
    // every factor must be exactly 1 and the mean exactly 1 -- no rounding
    // drift, whatever the team size or however many people stayed silent.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const size = 3 + Math.floor(rand() * 6); // 3..8
      const { low, high } = neutralRange(size - 1);
      const mates = (rater: number) =>
        Array.from({ length: size }, (_, i) => i + 1).filter((m) => m !== rater);

      const ballots: Record<number, Record<string, number>> = {};
      let usable = true;
      for (let rater = 1; rater <= size && usable; rater++) {
        if (rand() < 0.2) continue; // this member stayed silent
        const pts: Record<string, number> = {};
        let spent = 0;
        const list = mates(rater);
        list.forEach((m, i) => {
          if (i === list.length - 1) {
            const last = 100 - spent;
            // Larger teams have a band narrower than a point, so not every
            // draw closes at 100 in range; skip those rather than assert on an
            // allocation that legitimately sits outside the band.
            if (last < low || last > high) usable = false;
            pts[String(m)] = last;
          } else {
            const v = low + Math.floor(rand() * (high - low + 1));
            pts[String(m)] = v;
            spent += v;
          }
        });
        ballots[rater] = pts;
      }
      if (!usable) continue;
      checked += 1;

      const result = computeTeamFactors(team(size, ballots), P);
      expect(result.teamMean).toBe(1);
      expect(result.members.every((m) => m.factor === 1)).toBe(true);
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe("scapegoating arithmetic", () => {
  // The claim the settings panel makes: n-1 members agreeing to sink the last
  // one gain less between them than that one loses. It holds while
  // (n-1)*(ceiling-1) < (1-floor) — a statement about team size, not only about
  // the caps, which is why the panel now names the size it is talking about.
  const defaults = DEFAULT_FACTOR_PARAMS;

  it("holds at the default caps for teams up to six", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      expect(scapegoatingIsNegativeSum(n, defaults)).toBe(true);
    }
  });

  it("fails at the default caps from seven upward", () => {
    for (const n of [7, 8, 12]) {
      expect(scapegoatingIsNegativeSum(n, defaults)).toBe(false);
    }
  });

  it("reports the largest safe team size, and agrees with the predicate", () => {
    const max = maxTeamSizeForNegativeSum(defaults);
    expect(max).toBe(6);
    expect(scapegoatingIsNegativeSum(max, defaults)).toBe(true);
    expect(scapegoatingIsNegativeSum(max + 1, defaults)).toBe(false);
  });

  it("a tighter ceiling buys larger safe teams", () => {
    const tight = { ...defaults, factorCeiling: 1.02 };
    expect(maxTeamSizeForNegativeSum(tight)).toBeGreaterThan(maxTeamSizeForNegativeSum(defaults));
    expect(scapegoatingIsNegativeSum(12, tight)).toBe(true);
  });

  it("a ceiling of exactly 1.00 makes every team size safe", () => {
    const noGain = { ...defaults, factorCeiling: 1 };
    expect(maxTeamSizeForNegativeSum(noGain)).toBe(Infinity);
    expect(scapegoatingIsNegativeSum(50, noGain)).toBe(true);
  });

  it("the numbers behind the claim, worked through at five", () => {
    // Four markers each reaching the ceiling gain 0.05; the target hits the
    // floor and loses 0.30. The play costs the team 0.10 overall.
    const gain = 4 * (defaults.factorCeiling - 1);
    const loss = 1 - defaults.factorFloor;
    expect(gain).toBeCloseTo(0.2, 10);
    expect(loss).toBeCloseTo(0.3, 10);
    expect(gain).toBeLessThan(loss);
  });
});

describe("publication thresholds", () => {
  it("a factor needs two real raters, per-share detail needs three", () => {
    // A factor is an invertible function of the share, so one real ballot
    // published as a factor *is* that ballot handed back to the student.
    expect(MIN_RATERS_TO_PUBLISH).toBe(2);
    expect(MIN_RATERS_FOR_DETAIL).toBe(3);
    expect(MIN_RATERS_FOR_DETAIL).toBeGreaterThanOrEqual(MIN_RATERS_TO_PUBLISH);
  });

  it("shareToFactor is invertible outside the dead band, which is why", () => {
    const p = DEFAULT_FACTOR_PARAMS;
    // Below the ceiling, distinct shares give distinct factors...
    expect(shareToFactor(1.1, p)).not.toBe(shareToFactor(1.15, p));
    expect(shareToFactor(0.8, p)).not.toBe(shareToFactor(0.7, p));
    // ...and the share reads straight back off the factor:
    //   share = 1 + (f - 1) / k + deadband
    const f = shareToFactor(1.1, p);
    expect(1 + (f - 1) / p.damping + p.deadband).toBeCloseTo(1.1, 10);
    const g = shareToFactor(0.8, p);
    expect(1 - (1 - g) / p.damping - p.deadband).toBeCloseTo(0.8, 10);
  });
});
