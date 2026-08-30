import { describe, expect, it } from "vitest";
import {
  evenSplit,
  justificationApplies,
  needsJustification,
  neutralRange,
  pruneJustifications,
  reconcileBallot,
  validatePeerEval,
  validateSubmittedBallot,
} from "../src/lib/evalValidation";
import { DEFAULT_FACTOR_PARAMS } from "../src/lib/teamFactor";
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

describe("validateSubmittedBallot", () => {
  // The instructor's re-check after decryption. Peer-eval payloads are
  // encrypted, so the security rules can only ever see the envelope — this is
  // the only place a hand-crafted ballot can be caught.
  const expected = { raterCodeIndex: 1, teammateCodeIndexes: [2, 3, 4, 5], teamLabel: "Team 1" };
  const config = { includeBehaviors: false, behaviorCount: 0 };

  const good: PeerEvalAnswers = {
    round: "summative",
    raterCodeIndex: 1,
    teamLabel: "Team 1",
    points: { "2": 25, "3": 25, "4": 25, "5": 25 },
    justifications: {},
  };

  it("accepts a ballot the form would have produced", () => {
    expect(validateSubmittedBallot(good, expected, config)).toEqual([]);
  });

  it("rejects an allocation that does not sum to 100", () => {
    const p = validateSubmittedBallot(
      { ...good, points: { "2": 100, "3": 100, "4": 100, "5": 100 } },
      expected,
      config,
    );
    expect(p.some((m) => m.includes("sum to exactly 100"))).toBe(true);
  });

  it("rejects negative and out-of-range allocations", () => {
    const p = validateSubmittedBallot(
      { ...good, points: { "2": -50, "3": 50, "4": 50, "5": 50 } },
      expected,
      config,
    );
    expect(p.some((m) => m.includes("between 0 and 100"))).toBe(true);
  });

  it("rejects points aimed at somebody outside the team", () => {
    const p = validateSubmittedBallot(
      { ...good, points: { "2": 25, "3": 25, "4": 25, "5": 25, "99": 0 } },
      expected,
      config,
    );
    expect(p).toContain("Points were allocated to someone who is not a teammate.");
  });

  it("rejects a ballot claiming to be from someone else", () => {
    const p = validateSubmittedBallot({ ...good, raterCodeIndex: 7 }, expected, config);
    expect(p.some((m) => m.includes("claims to be from #7"))).toBe(true);
  });

  it("rejects a ballot naming a different team", () => {
    const p = validateSubmittedBallot({ ...good, teamLabel: "Team 9" }, expected, config);
    expect(p.some((m) => m.includes("Team 9"))).toBe(true);
  });

  it("survives a payload with the objects missing entirely", () => {
    const wrecked = { round: "summative", raterCodeIndex: 1, teamLabel: "Team 1" } as unknown as PeerEvalAnswers;
    expect(() => validateSubmittedBallot(wrecked, expected, config)).not.toThrow();
    expect(validateSubmittedBallot(wrecked, expected, config).length).toBeGreaterThan(0);
  });

  it("rejects behavior ratings outside 1-5 when behaviors are on", () => {
    const p = validateSubmittedBallot(
      { ...good, behaviorRatings: { "2": [9], "3": [3], "4": [3], "5": [3] } },
      expected,
      { includeBehaviors: true, behaviorCount: 1 },
    );
    expect(p.some((m) => m.includes("whole numbers from 1 to 5"))).toBe(true);
  });
});

describe("reconcileBallot", () => {
  const ballot = (points: Record<string, number>, extra: Partial<PeerEvalAnswers> = {}): PeerEvalAnswers => ({
    round: "summative",
    raterCodeIndex: 1,
    teamLabel: "Team 1",
    points,
    justifications: {},
    ...extra,
  });

  it("is a provable no-op when nobody has left", () => {
    // The ordinary path must be untouched, object identity included, so this
    // cannot quietly change results for teams nothing happened to.
    const b = ballot({ "2": 40, "3": 30, "4": 30 });
    const out = reconcileBallot(b, [2, 3, 4]);
    expect(out.answers).toBe(b);
    expect(out.dropped).toEqual([]);
    expect(out.noOpinion).toBe(false);
  });

  it("drops a departed teammate and scales the rest back to 100", () => {
    const out = reconcileBallot(ballot({ "2": 40, "3": 30, "4": 30 }), [2, 3]);
    expect(out.answers.points["2"]).toBeCloseTo(57.14, 2);
    expect(out.answers.points["3"]).toBeCloseTo(42.86, 2);
    expect(out.dropped).toEqual([{ codeIndex: 4, points: 30 }]);
  });

  it("preserves what the rater actually judged about the survivors", () => {
    const out = reconcileBallot(ballot({ "2": 40, "3": 30, "4": 30 }), [2, 3]);
    const before = 40 / 30;
    const after = out.answers.points["2"] / out.answers.points["3"];
    expect(after).toBeCloseTo(before, 10);
  });

  it("always sums to exactly 100", () => {
    for (let trial = 0; trial < 300; trial++) {
      const size = 3 + Math.floor(Math.random() * 6);
      const idx = Array.from({ length: size }, (_, i) => i + 2);
      let left = 100;
      const points: Record<string, number> = {};
      idx.forEach((i, k) => {
        const p = k === idx.length - 1 ? left : Math.floor(Math.random() * (left + 1));
        points[String(i)] = p;
        left -= p;
      });
      const survivors = idx.filter(() => Math.random() > 0.35);
      const out = reconcileBallot(ballot(points), survivors);
      if (out.noOpinion || out.dropped.length === 0) continue;
      const values = Object.values(out.answers.points);
      expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    }
  });

  it("reports no opinion when every surviving allocation was zero", () => {
    const out = reconcileBallot(ballot({ "2": 0, "3": 0, "4": 100 }), [2, 3]);
    expect(out.noOpinion).toBe(true);
  });

  it("reports no opinion when the team is down to one person", () => {
    const out = reconcileBallot(ballot({ "2": 100 }), []);
    expect(out.noOpinion).toBe(true);
    expect(() => reconcileBallot(ballot({ "2": 100 }), [])).not.toThrow();
  });

  it("keeps a survivor's justification verbatim even when scaling moves the number back in band", () => {
    // The student wrote that sentence about the allocation they chose. Re-pruning
    // against our own arithmetic would delete it for them.
    const out = reconcileBallot(
      ballot({ "2": 20, "3": 20, "4": 60 }, { justifications: { "2": "Missed two meetings.", "4": "Carried us." } }),
      [2, 3],
    );
    expect(out.answers.points).toEqual({ "2": 50, "3": 50 });
    expect(out.answers.justifications["2"]).toBe("Missed two meetings.");
    expect(out.answers.justifications["4"]).toBeUndefined();
  });

  it("prunes behaviour ratings to the survivors without rescaling them", () => {
    const out = reconcileBallot(
      ballot({ "2": 50, "3": 50 }, { behaviorRatings: { "2": [5, 4, 3, 2], "3": [1, 1, 1, 1] } }),
      [2],
    );
    expect(out.answers.behaviorRatings).toEqual({ "2": [5, 4, 3, 2] });
  });

  it("carries the rest of the ballot through untouched", () => {
    const out = reconcileBallot(
      ballot({ "2": 50, "3": 50 }, { commentToInstructor: "Please read this." }),
      [2],
    );
    expect(out.answers.raterCodeIndex).toBe(1);
    expect(out.answers.teamLabel).toBe("Team 1");
    expect(out.answers.round).toBe("summative");
    expect(out.answers.commentToInstructor).toBe("Please read this.");
  });

  it("leaves a neutral rater neutral after a teammate departs", () => {
    // The property that actually matters, and the one integer apportionment
    // broke: a rater who accepted the form's default even split must not end up
    // pushing anyone's factor off 1.00 just because the team got smaller. On a
    // team of nine an even split is 13/13/13/13/12/12/12/12, and rounding the
    // reconciled ballot back to whole points turned the 12s into a share of
    // 0.91 — outside the dead band, and a grade penalty invented by arithmetic.
    for (const teammates of [2, 3, 4, 5, 6, 7, 8]) {
      const idx = Array.from({ length: teammates }, (_, i) => i + 2);
      const survivors = idx.slice(0, -1);
      const out = reconcileBallot(ballot(evenSplit(idx)), survivors);
      const neutral = 100 / survivors.length;
      for (const i of survivors) {
        const share = out.answers.points[String(i)] / neutral;
        expect(Math.abs(share - 1)).toBeLessThanOrEqual(DEFAULT_FACTOR_PARAMS.deadband);
      }
    }
  });
});
