import { describe, expect, it } from "vitest";
import { solve } from "../src/solver/solve";
import { evaluateAssignment } from "../src/solver/evaluate";
import type { SolverInput, SolverStudent, SolverTeam } from "../src/solver/types";
import type { Constraint, Question } from "../src/types";

function student(i: number, answers: SolverStudent["answers"]): SolverStudent {
  return { hash: `hash${i}`, codeIndex: i, answers, submitted: true };
}

function team(id: string, minSize: number, maxSize: number, requirements: SolverTeam["requirements"] = []): SolverTeam {
  return { id, name: id, minSize, maxSize, requirements };
}

const genderQ: Question = {
  id: "gender",
  kind: "single",
  prompt: "Gender",
  required: true,
  options: ["Woman", "Man"],
};
const codingQ: Question = { id: "coding", kind: "number", prompt: "Coding skill", required: true, min: 1, max: 5 };
const teammatesQ: Question = { id: "mates", kind: "teammates", prompt: "Teammates", required: false, maxCodes: 2 };
const rankingQ: Question = {
  id: "ranking",
  kind: "projectRanking",
  prompt: "Rank projects",
  required: true,
  rankCount: 2,
};

describe("MIP solver", () => {
  it("assigns every student to exactly one team within size limits", async () => {
    const input: SolverInput = {
      students: Array.from({ length: 7 }, (_, i) => student(i, {})),
      teams: [team("a", 2, 4), team("b", 2, 4)],
      idealTeamSize: 3,
      constraints: [],
      questions: [],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const all = [...result.teams.a, ...result.teams.b];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(result.teams.a.length).toBeGreaterThanOrEqual(2);
    expect(result.teams.b.length).toBeGreaterThanOrEqual(2);
  });

  it("anti-isolation keeps the two women together", async () => {
    const students = [
      student(0, { gender: "Woman" }),
      student(1, { gender: "Woman" }),
      student(2, { gender: "Man" }),
      student(3, { gender: "Man" }),
      student(4, { gender: "Man" }),
      student(5, { gender: "Man" }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 3, 3), team("b", 3, 3)],
      idealTeamSize: 3,
      constraints: [{ id: "c1", kind: "antiIsolation", weight: "must", questionId: "gender", value: "Woman" }],
      questions: [genderQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const womenTeamA = result.teams.a.filter((h) => ["hash0", "hash1"].includes(h)).length;
    expect([0, 2]).toContain(womenTeamA);
    expect(result.objective).toBeLessThan(1); // no violation penalty
  });

  it("project requirements pull the only CS major onto the team that needs one", async () => {
    const students = [
      student(0, { "auto-attr-major": "Computer Science" }),
      student(1, { "auto-attr-major": "Business" }),
      student(2, { "auto-attr-major": "Business" }),
      student(3, { "auto-attr-major": "Business" }),
    ];
    const input: SolverInput = {
      students,
      teams: [
        team("needsCs", 2, 2, [
          { attributeKey: "major", attributeLabel: "Major", value: "Computer Science", minCount: 1 },
        ]),
        team("other", 2, 2),
      ],
      idealTeamSize: 2,
      constraints: [{ id: "c1", kind: "projectRequirements", weight: "must" }],
      questions: [],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    expect(result.teams.needsCs).toContain("hash0");
  });

  it("teammate preferences pair mutual friends", async () => {
    const students = [
      student(0, { mates: ["hash1"] }),
      student(1, { mates: ["hash0"] }),
      student(2, {}),
      student(3, {}),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [{ id: "c1", kind: "teammatePreference", weight: "important" }],
      questions: [teammatesQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const teamOf = (h: string) => (result.teams.a.includes(h) ? "a" : "b");
    expect(teamOf("hash0")).toBe(teamOf("hash1"));
  });

  it("project preferences give students their first choice when capacity allows", async () => {
    const students = [
      student(0, { ranking: ["a", "b"] }),
      student(1, { ranking: ["a", "b"] }),
      student(2, { ranking: ["b", "a"] }),
      student(3, { ranking: ["b", "a"] }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [{ id: "c1", kind: "projectPreference", weight: "important" }],
      questions: [rankingQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    expect(result.teams.a.sort()).toEqual(["hash0", "hash1"]);
    expect(result.teams.b.sort()).toEqual(["hash2", "hash3"]);
  });

  it("evaluator agrees with the solver objective", async () => {
    const students = [
      student(0, { gender: "Woman", coding: 5, mates: ["hash3"] }),
      student(1, { gender: "Woman", coding: 1 }),
      student(2, { gender: "Man", coding: 3 }),
      student(3, { gender: "Man", coding: 2 }),
      student(4, { gender: "Man", coding: 4 }),
      student(5, { gender: "Man", coding: 1 }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 3, 3), team("b", 3, 3)],
      idealTeamSize: 3,
      constraints: [
        { id: "c1", kind: "antiIsolation", weight: "must", questionId: "gender", value: "Woman" },
        { id: "c2", kind: "minCapability", weight: "important", questionId: "coding", threshold: 4, minCount: 1 },
        { id: "c3", kind: "teammatePreference", weight: "nice" },
      ],
      questions: [genderQ, codingQ, teammatesQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const evaluation = evaluateAssignment(input, result.teams);
    expect(evaluation.totalPenalty).toBeCloseTo(result.objective, 3);
  });

  it("handles 100 students and 20 teams quickly", async () => {
    const majors = ["CS", "Business", "Design"];
    const students = Array.from({ length: 100 }, (_, i) =>
      student(i, {
        gender: i % 4 === 0 ? "Woman" : "Man",
        coding: (i % 5) + 1,
        "auto-attr-major": majors[i % 3],
      }),
    );
    const teams = Array.from({ length: 20 }, (_, t) =>
      team(`t${t}`, 4, 6, [{ attributeKey: "major", attributeLabel: "Major", value: "CS", minCount: 1 }]),
    );
    const input: SolverInput = {
      students,
      teams,
      idealTeamSize: 5,
      constraints: [
        { id: "c1", kind: "projectRequirements", weight: "must" },
        { id: "c2", kind: "antiIsolation", weight: "important", questionId: "gender", value: "Woman" },
        { id: "c3", kind: "balanceNumeric", weight: "nice", questionId: "coding" },
      ],
      questions: [genderQ, codingQ],
      timeLimitSeconds: 20,
    };
    const start = Date.now();
    const result = await solve(input);
    expect(Date.now() - start).toBeLessThan(25_000);
    const all = Object.values(result.teams).flat();
    expect(all).toHaveLength(100);
    expect(new Set(all).size).toBe(100);
    // Every team got a CS major (feasible here) and no lone woman.
    const evaluation = evaluateAssignment(input, result.teams);
    const mustViolations = evaluation.details.filter((d) => d.severity === "must");
    expect(mustViolations).toHaveLength(0);
  }, 40_000);
});

describe("solver robustness", () => {
  it("never collapses the class onto team 1 when a solution is missing", async () => {
    // A solve that returns no incumbent leaves every x_i_t column absent. The
    // argmax over nothing used to pick index 0 for everyone and report it as
    // "the best allocation found so far".
    const input: SolverInput = {
      students: Array.from({ length: 6 }, (_, i) => student(i, {})),
      teams: [team("a", 2, 3), team("b", 2, 3)],
      idealTeamSize: 3,
      constraints: [],
      questions: [],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    // With a real solve this passes on its merits; the point of the assertion is
    // that a degenerate result can no longer look like this one.
    expect(result.teams.a.length).toBeGreaterThan(0);
    expect(result.teams.b.length).toBeGreaterThan(0);
  });

  it("returns teams inside their declared size limits", async () => {
    const input: SolverInput = {
      students: Array.from({ length: 9 }, (_, i) => student(i, {})),
      teams: [team("a", 3, 3), team("b", 3, 3), team("c", 3, 3)],
      idealTeamSize: 3,
      constraints: [],
      questions: [],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    for (const id of ["a", "b", "c"]) expect(result.teams[id]).toHaveLength(3);
  });
});

describe("numeric balance with non-respondents", () => {
  // A student who never submitted has no answer at all. Scoring them 0 put them
  // below the bottom of a 1-5 scale, so the optimizer worked to spread
  // non-respondents evenly as if they were the weakest students in the class.
  const balance: Constraint = { id: "bal", kind: "balanceNumeric", weight: "important", questionId: "coding" };

  it("ignores students with no answer when computing the mean", () => {
    const students = [
      student(0, { coding: 5 }),
      student(1, { coding: 5 }),
      { ...student(2, {}), submitted: false },
      { ...student(3, {}), submitted: false },
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [balance],
      questions: [codingQ],
      timeLimitSeconds: 10,
    };
    // Both respondents answered 5, so the mean is 5 and every deviation is zero:
    // there is nothing to balance and no split should be penalised.
    const together = evaluateAssignment(input, { a: ["hash0", "hash1"], b: ["hash2", "hash3"] });
    const apart = evaluateAssignment(input, { a: ["hash0", "hash2"], b: ["hash1", "hash3"] });
    expect(together.totalPenalty).toBe(apart.totalPenalty);
    expect(together.details.some((d) => d.label.includes("Imbalanced"))).toBe(false);
  });

  it("still balances the students who did answer", () => {
    const students = [
      student(0, { coding: 5 }),
      student(1, { coding: 5 }),
      student(2, { coding: 1 }),
      student(3, { coding: 1 }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [balance],
      questions: [codingQ],
      timeLimitSeconds: 10,
    };
    const stacked = evaluateAssignment(input, { a: ["hash0", "hash1"], b: ["hash2", "hash3"] });
    const mixed = evaluateAssignment(input, { a: ["hash0", "hash2"], b: ["hash1", "hash3"] });
    expect(stacked.totalPenalty).toBeGreaterThan(mixed.totalPenalty);
  });
});

const leadQ: Question = {
  id: "lead",
  kind: "single",
  prompt: "Leadership preference",
  required: false,
  options: ["I prefer to lead", "Happy to contribute without leading"],
};
const FOLLOWER = "Happy to contribute without leading";
const workQ: Question = {
  id: "work",
  kind: "single",
  prompt: "Work preference",
  required: false,
  options: ["Mostly in person", "Hybrid", "Mostly remote"],
};

describe("category coverage", () => {
  const constraint: Constraint = {
    id: "c1",
    kind: "minCategory",
    weight: "must",
    questionId: "lead",
    value: "I prefer to lead",
    minCount: 1,
  };

  it("spreads the willing leaders so every team has one", async () => {
    // Two leaders, two teams: the only allocation without a violation puts one
    // on each. Anti-isolation would have done the opposite and paired them.
    const students = [
      student(0, { lead: "I prefer to lead" }),
      student(1, { lead: "I prefer to lead" }),
      student(2, { lead: FOLLOWER }),
      student(3, { lead: FOLLOWER }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [constraint],
      questions: [leadQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const leadersOnA = result.teams.a.filter((h) => ["hash0", "hash1"].includes(h)).length;
    expect(leadersOnA).toBe(1);
    expect(result.objective).toBeLessThan(1);
  });

  it("charges the weight once per team left without one", () => {
    const students = [
      student(0, { lead: "I prefer to lead" }),
      student(1, { lead: FOLLOWER }),
      student(2, { lead: FOLLOWER }),
      student(3, { lead: FOLLOWER }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [{ ...constraint, weight: "important" }],
      questions: [leadQ],
      timeLimitSeconds: 10,
    };
    // Only one leader exists, so exactly one team must go without.
    const evaluation = evaluateAssignment(input, { a: ["hash0", "hash1"], b: ["hash2", "hash3"] });
    expect(evaluation.totalPenalty).toBe(100);
    expect(evaluation.byTeam.b).toHaveLength(1);
    expect(evaluation.byTeam.a ?? []).toHaveLength(0);
  });

  it("counts a multi-select answer the student ticked among others", () => {
    const rolesQ: Question = {
      id: "roles",
      kind: "multi",
      prompt: "Preferred team roles",
      required: false,
      options: ["Leader / coordinator", "Writer / communicator"],
    };
    const students = [
      student(0, { roles: ["Writer / communicator", "Leader / coordinator"] }),
      student(1, { roles: ["Writer / communicator"] }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2)],
      idealTeamSize: 2,
      constraints: [
        {
          id: "c1",
          kind: "minCategory",
          weight: "must",
          questionId: "roles",
          value: "Leader / coordinator",
          minCount: 1,
        },
      ],
      questions: [rolesQ],
      timeLimitSeconds: 10,
    };
    expect(evaluateAssignment(input, { a: ["hash0", "hash1"] }).totalPenalty).toBe(0);
  });
});

describe("category alignment", () => {
  const constraint: Constraint = { id: "c1", kind: "alignCategory", weight: "must", questionId: "work" };

  it("groups students who want to work the same way", async () => {
    const students = [
      student(0, { work: "Mostly in person" }),
      student(1, { work: "Mostly in person" }),
      student(2, { work: "Mostly remote" }),
      student(3, { work: "Mostly remote" }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [constraint],
      questions: [workQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const teamOf = (h: string) => (result.teams.a.includes(h) ? "a" : "b");
    expect(teamOf("hash0")).toBe(teamOf("hash1"));
    expect(teamOf("hash2")).toBe(teamOf("hash3"));
    expect(result.objective).toBeLessThan(1);
  });

  it("charges only the members outside their team's majority", () => {
    const students = [
      student(0, { work: "Mostly in person" }),
      student(1, { work: "Mostly in person" }),
      student(2, { work: "Mostly remote" }),
      student(3, { work: "Hybrid" }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 4, 4)],
      idealTeamSize: 4,
      constraints: [{ ...constraint, weight: "important" }],
      questions: [workQ],
      timeLimitSeconds: 10,
    };
    // Two in person, one remote, one hybrid: the majority is "Mostly in
    // person", leaving two odd ones out at 100 apiece.
    const evaluation = evaluateAssignment(input, { a: ["hash0", "hash1", "hash2", "hash3"] });
    const align = evaluation.details.filter((d) => d.label.includes("not on the team"));
    expect(align).toHaveLength(1);
    expect(align[0].penalty).toBe(200);
  });

  it("leaves students who never answered out of the count", () => {
    const students = [
      student(0, { work: "Mostly in person" }),
      student(1, { work: "Mostly remote" }),
      { ...student(2, {}), submitted: false },
      { ...student(3, {}), submitted: false },
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 2, 2), team("b", 2, 2)],
      idealTeamSize: 2,
      constraints: [{ ...constraint, weight: "important" }],
      questions: [workQ],
      timeLimitSeconds: 10,
    };
    // One respondent per team, so each team is internally consistent and the
    // non-respondents cost nothing wherever they land.
    const evaluation = evaluateAssignment(input, { a: ["hash0", "hash2"], b: ["hash1", "hash3"] });
    expect(evaluation.totalPenalty).toBe(0);
  });

  it("evaluator agrees with the solver objective on both new constraints", async () => {
    const students = [
      student(0, { lead: "I prefer to lead", work: "Mostly in person" }),
      student(1, { lead: FOLLOWER, work: "Mostly in person" }),
      student(2, { lead: FOLLOWER, work: "Mostly remote" }),
      student(3, { lead: "I prefer to lead", work: "Mostly remote" }),
      student(4, { lead: FOLLOWER, work: "Hybrid" }),
      student(5, { lead: FOLLOWER, work: "Mostly remote" }),
    ];
    const input: SolverInput = {
      students,
      teams: [team("a", 3, 3), team("b", 3, 3)],
      idealTeamSize: 3,
      constraints: [
        { id: "c1", kind: "minCategory", weight: "must", questionId: "lead", value: "I prefer to lead", minCount: 1 },
        { id: "c2", kind: "alignCategory", weight: "important", questionId: "work" },
      ],
      questions: [leadQ, workQ],
      timeLimitSeconds: 10,
    };
    const result = await solve(input);
    const evaluation = evaluateAssignment(input, result.teams);
    expect(evaluation.totalPenalty).toBeCloseTo(result.objective, 3);
  });
});
