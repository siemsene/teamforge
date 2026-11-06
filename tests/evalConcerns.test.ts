import { describe, expect, it } from "vitest";
import { buildTroubleReport } from "../src/lib/evalConcerns";
import { DEFAULT_FACTOR_PARAMS, computeTeamFactors } from "../src/lib/teamFactor";
import type { Nicknames, PeerEvalAnswers, TeamDirectory } from "../src/types";

const NICKNAMES: Nicknames = { "1": "Ana", "2": "Ben", "3": "Cara", "4": "Dev" };
const BEHAVIORS = ["Shows up", "Delivers"];

const TEAMS: TeamDirectory["teams"] = [
  {
    token: "t1",
    label: "Team 1",
    members: [1, 2, 3, 4].map((i) => ({ codeIndex: i, codeHash: `h${i}` })),
  },
];

function ballot(rater: number, points: Record<number, number>, extra: Partial<PeerEvalAnswers> = {}): PeerEvalAnswers {
  const ratings: Record<string, number[]> = {};
  for (const k of Object.keys(points)) ratings[k] = Number(k) === 4 ? [2, 3] : [5, 5];
  return {
    round: "formative",
    raterCodeIndex: rater,
    teamLabel: "Team 1",
    points: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, v])),
    justifications: {},
    behaviorRatings: ratings,
    ...extra,
  };
}

function report(ballots: PeerEvalAnswers[]) {
  const factors = computeTeamFactors(
    { teamLabel: "Team 1", memberCodeIndexes: [1, 2, 3, 4], submissions: ballots },
    DEFAULT_FACTOR_PARAMS,
  );
  const byRater = new Map(ballots.map((b) => [`h${b.raterCodeIndex}`, { submitted: b }]));
  return buildTroubleReport({
    results: [{ factors }],
    teams: TEAMS,
    byRater,
    nicknames: NICKNAMES,
    includeBehaviors: true,
    behaviors: BEHAVIORS,
  });
}

describe("buildTroubleReport", () => {
  it("flags a free rider with their factor, behaviours and the justifications behind it", () => {
    const why = { "4": "Missed every meeting." };
    const r = report([
      ballot(1, { 2: 40, 3: 40, 4: 20 }, { justifications: why }),
      ballot(2, { 1: 40, 3: 40, 4: 20 }, { justifications: why }),
      ballot(3, { 1: 40, 2: 40, 4: 20 }, { justifications: why, commentToInstructor: "Dev has gone quiet." }),
    ]);
    expect(r.teams).toHaveLength(1);
    const [dev] = r.teams[0].students;
    expect(dev.codeIndex).toBe(4);
    expect(dev.name).toBe("Dev (#4)");
    expect(dev.reasons.join(" ")).toMatch(/below 0\.90/);
    expect(dev.lowBehaviors).toEqual([
      { label: "Shows up", average: 2 },
      { label: "Delivers", average: 3 },
    ]);
    expect(dev.lowAllocations).toHaveLength(3);
    expect(dev.lowAllocations[0].justification).toBe("Missed every meeting.");
    expect(r.comments).toEqual([{ teamLabel: "Team 1", rater: "Cara (#3)", text: "Dev has gone quiet." }]);
    expect(r.nonSubmitters).toEqual([{ teamLabel: "Team 1", names: ["Dev (#4)"] }]);
  });

  it("flags nothing on an even split with good behaviour", () => {
    const even = (rater: number) => {
      const pts: Record<number, number> = {};
      for (const i of [1, 2, 3, 4]) if (i !== rater) pts[i] = i === 4 || (rater === 4 && i === 3) ? 34 : 33;
      const b = ballot(rater, pts);
      b.behaviorRatings = Object.fromEntries(Object.keys(pts).map((k) => [k, [4, 4]]));
      return b;
    };
    const r = report([even(1), even(2), even(3), even(4)]);
    expect(r.teams).toEqual([]);
    expect(r.comments).toEqual([]);
    expect(r.nonSubmitters).toEqual([]);
    expect(r.studentCount).toBe(4);
  });

  it("surfaces one hostile rater even though the trim kept the factor at 1.00", () => {
    const fine = (rater: number, others: number[]) => {
      const b = ballot(rater, Object.fromEntries(others.map((o, i) => [o, i === 0 ? 34 : 33])));
      b.behaviorRatings = Object.fromEntries(others.map((o) => [String(o), [4, 4]]));
      return b;
    };
    const hostile = ballot(4, { 1: 10, 2: 45, 3: 45 }, { justifications: { "1": "Took over everything." } });
    hostile.behaviorRatings = { "1": [4, 4], "2": [4, 4], "3": [4, 4] };
    const r = report([fine(1, [2, 3, 4]), fine(2, [1, 3, 4]), fine(3, [1, 2, 4]), hostile]);
    const ana = r.teams[0].students.find((s) => s.codeIndex === 1)!;
    expect(ana.factor).toBe(1);
    expect(ana.reasons.join(" ")).toMatch(/One teammate gave them 0\.30/);
    expect(ana.lowAllocations).toEqual([
      { rater: "Dev (#4)", points: 10, evenSplit: 100 / 3, justification: "Took over everything." },
    ]);
  });
});
