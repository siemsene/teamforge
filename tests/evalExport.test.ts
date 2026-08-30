import { describe, expect, it } from "vitest";
import { buildDetailRows, buildSummaryRows } from "../src/lib/evalExport";
import { DEFAULT_FACTOR_PARAMS, computeTeamFactors } from "../src/lib/teamFactor";
import type { Nicknames, PeerEvalAnswers, TeamDirectory } from "../src/types";

const NAMES = ["Ana", "Ben", "Cara"];
const NICKNAMES: Nicknames = { "1": "Ana", "2": "Ben", "3": "Cara" };

const TEAMS: TeamDirectory["teams"] = [
  {
    token: "t1",
    label: "Team 1",
    members: [
      { codeIndex: 1, codeHash: "h1" },
      { codeIndex: 2, codeHash: "h2" },
      { codeIndex: 3, codeHash: "h3" },
    ],
  },
];

function answers(rater: number, overrides: Partial<PeerEvalAnswers> = {}): PeerEvalAnswers {
  const points: Record<string, number> = {};
  for (const i of [1, 2, 3]) if (i !== rater) points[String(i)] = 50;
  return {
    round: "formative",
    raterCodeIndex: rater,
    teamLabel: "Team 1",
    points,
    justifications: {},
    ...overrides,
  };
}

/** column index -> header name, for readable assertions */
const COL = { team: 0, rater: 1, ratee: 2, points: 3, submitted: 4, justification: 5, comment: 6 };

/** The export takes both the scored and the as-submitted ballot. These fixtures
 * predate reconciliation, where the two are the same. */
const asPairs = (m: Map<string, PeerEvalAnswers>) =>
  new Map([...m].map(([h, a]) => [h, { scored: a, submitted: a }] as const));

describe("buildDetailRows", () => {
  it("keeps the comment of the team's first member, which used to be dropped", () => {
    // The regression: the comment was pinned to the row whose *ratee* was
    // members[0]. A rater never rates themselves, so when the rater *was*
    // members[0] that row never existed and their note vanished.
    const byRater = new Map([
      ["h1", answers(1, { commentToInstructor: "Ana's private note." })],
      ["h2", answers(2, { commentToInstructor: "Ben's private note." })],
      ["h3", answers(3, { commentToInstructor: "Cara's private note." })],
    ]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES);
    const comments = rows.slice(1).map((r) => String(r[COL.comment])).filter(Boolean);
    expect(comments.sort()).toEqual([
      "Ana's private note.",
      "Ben's private note.",
      "Cara's private note.",
    ]);
  });

  it("writes each comment exactly once, on that rater's first row", () => {
    const byRater = new Map([["h1", answers(1, { commentToInstructor: "Only once." })]]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES).slice(1);
    expect(rows).toHaveLength(2); // Ana rates Ben and Cara
    expect(rows[0][COL.comment]).toBe("Only once.");
    expect(rows[1][COL.comment]).toBe("");
  });

  it("emits one row per (rater, ratee) and never a self-rating", () => {
    const byRater = new Map([
      ["h1", answers(1)],
      ["h2", answers(2)],
      ["h3", answers(3)],
    ]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES).slice(1);
    expect(rows).toHaveLength(6); // 3 raters x 2 teammates
    for (const r of rows) expect(r[COL.rater]).not.toBe(r[COL.ratee]);
  });

  it("skips raters who did not submit, without disturbing the others", () => {
    const byRater = new Map([["h2", answers(2, { commentToInstructor: "Ben was here." })]]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r[COL.rater] === "Ben")).toBe(true);
    expect(rows[0][COL.comment]).toBe("Ben was here.");
  });

  it("carries points and justifications through, blank where absent", () => {
    const byRater = new Map([
      ["h1", answers(1, { points: { "2": 70, "3": 30 }, justifications: { "2": "Carried the build." } })],
    ]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES).slice(1);
    const ben = rows.find((r) => r[COL.ratee] === "Ben")!;
    const cara = rows.find((r) => r[COL.ratee] === "Cara")!;
    expect(ben[COL.points]).toBe(70);
    expect(ben[COL.justification]).toBe("Carried the build.");
    expect(cara[COL.justification]).toBe("");
  });

  it("falls back to the code index before a student picks a display name", () => {
    const byRater = new Map([["h1", answers(1)]]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), {}).slice(1);
    expect(rows[0][COL.rater]).toBe("#1");
    expect(rows[0][COL.ratee]).toBe("#2");
  });

  it("treats a whitespace-only comment as no comment", () => {
    const byRater = new Map([["h1", answers(1, { commentToInstructor: "   " })]]);
    const rows = buildDetailRows(TEAMS, asPairs(byRater), NICKNAMES).slice(1);
    expect(rows[0][COL.comment]).toBe("");
  });
});

describe("buildSummaryRows", () => {
  const factors = computeTeamFactors(
    {
      teamLabel: "Team 1",
      memberCodeIndexes: [1, 2, 3],
      submissions: [answers(1), answers(2), answers(3)],
    },
    DEFAULT_FACTOR_PARAMS,
  );

  it("emits a header plus one row per student", () => {
    const rows = buildSummaryRows([{ factors }], NICKNAMES, {
      includeBehaviors: false,
      behaviors: [],
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("share");
    expect(rows[0]).toContain("teamMean");
    expect(rows[0]).not.toContain("behaviorAvg1");
    expect(rows.slice(1).map((r) => r[1])).toEqual(NAMES);
  });

  it("adds one behavior column per configured behavior when enabled", () => {
    const rows = buildSummaryRows([{ factors }], NICKNAMES, {
      includeBehaviors: true,
      behaviors: ["a", "b"],
    });
    expect(rows[0].slice(-2)).toEqual(["behaviorAvg1", "behaviorAvg2"]);
    // No behavior ratings were submitted, so the cells are blank, not zeroes.
    expect(rows[1].slice(-2)).toEqual(["", ""]);
  });

  it("keeps a departed ratee's row, with what was written but nothing scored", () => {
    // #3 left the session after this ballot was submitted. What #1 said about
    // them is part of the record and must still export; the scored column is
    // blank because their points were redistributed across the survivors.
    const submitted = answers(1, { points: { "2": 40, "3": 60 } });
    const scored = answers(1, { points: { "2": 100 } });
    const rows = buildDetailRows(TEAMS, new Map([["h1", { scored, submitted }]]), NICKNAMES).slice(1);
    const departed = rows.find((r) => r[COL.ratee] === "Cara")!;
    expect(departed[COL.submitted]).toBe(60);
    expect(departed[COL.points]).toBe("");
    const kept = rows.find((r) => r[COL.ratee] === "Ben")!;
    expect(kept[COL.submitted]).toBe(40);
    expect(kept[COL.points]).toBe(100);
  });
});
