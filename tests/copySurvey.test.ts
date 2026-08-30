import { describe, expect, it } from "vitest";
import { planSurveyCopy, type CopySource, type CopyTarget } from "../src/features/survey-builder/copySurvey";
import type { Constraint, Question } from "../src/types";

/** Predictable ids, so the tests can assert on the remapping itself. */
function ids() {
  let n = 0;
  return () => `new${++n}`;
}

const coding: Question = { id: "q-coding", kind: "number", prompt: "Coding skill", required: true, min: 1, max: 5 };
const work: Question = {
  id: "q-work",
  kind: "single",
  prompt: "Work preference",
  required: false,
  options: ["Mostly in person", "Mostly remote"],
};
const mates: Question = { id: "q-mates", kind: "teammates", prompt: "Preferred teammates", required: false, maxCodes: 3 };
const autoMajor: Question = {
  id: "auto-attr-major",
  kind: "single",
  prompt: "What is your Major?",
  required: true,
  auto: true,
  attributeKey: "major",
  options: ["Business", "Computer Science"],
};
const autoRanking: Question = {
  id: "auto-project-ranking",
  kind: "projectRanking",
  prompt: "Rank the projects",
  required: true,
  auto: true,
  rankCount: 3,
};

const empty: CopyTarget = { questions: [], constraints: [] };

describe("planning a survey copy", () => {
  it("copies manual questions under fresh ids", () => {
    const source: CopySource = { questions: [coding, work], constraints: [] };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.questions.map((q) => q.id)).toEqual(["new1", "new2"]);
    expect(plan.questions.map((q) => q.prompt)).toEqual(["Coding skill", "Work preference"]);
    // Everything else about the question survives the trip.
    expect(plan.questions[1]).toMatchObject({ kind: "single", options: ["Mostly in person", "Mostly remote"] });
  });

  it("repoints copied constraints at the copied questions", () => {
    const source: CopySource = {
      questions: [coding, work],
      constraints: [
        { id: "c1", kind: "balanceNumeric", weight: "important", questionId: "q-coding" },
        { id: "c2", kind: "alignCategory", weight: "nice", questionId: "q-work" },
      ],
    };
    const plan = planSurveyCopy(source, empty, ids());
    // q-coding became new1 and q-work new2, so the constraints must follow.
    expect(plan.constraints).toMatchObject([
      { kind: "balanceNumeric", questionId: "new1" },
      { kind: "alignCategory", questionId: "new2" },
    ]);
    // Fresh constraint ids too, so a copy cannot collide with what is there.
    expect(plan.constraints.map((c) => c.id)).toEqual(["new3", "new4"]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves auto questions behind — they belong to the other session's projects", () => {
    const source: CopySource = { questions: [autoMajor, coding, autoRanking], constraints: [] };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.questions.map((q) => q.prompt)).toEqual(["Coding skill"]);
    expect(plan.skipped.map((s) => s.label)).toEqual(["What is your Major?", "Rank the projects"]);
  });

  it("drops a constraint whose question did not come across, rather than dangling it", () => {
    // Anti-isolation on the auto-generated major question: the question is
    // rebuilt from this session's own requirements, so the reference cannot hold.
    const source: CopySource = {
      questions: [autoMajor, coding],
      constraints: [
        { id: "c1", kind: "antiIsolation", weight: "must", questionId: "auto-attr-major", value: "Business" },
        { id: "c2", kind: "minCapability", weight: "important", questionId: "q-coding", threshold: 4, minCount: 1 },
      ],
    };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.constraints).toHaveLength(1);
    expect(plan.constraints[0]).toMatchObject({ kind: "minCapability", questionId: "new1" });
    expect(plan.skipped).toContainEqual({
      label: "Anti-isolation",
      reason: "the question it works on was not copied",
    });
  });

  it("never copies the project-requirements umbrella", () => {
    const source: CopySource = {
      questions: [],
      constraints: [{ id: "c1", kind: "projectRequirements", weight: "must" }],
    };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.constraints).toEqual([]);
    expect(plan.skipped[0].label).toBe("Project requirements");
  });

  it("carries teammate preferences along with the teammates question", () => {
    const source: CopySource = {
      questions: [mates],
      constraints: [{ id: "c1", kind: "teammatePreference", weight: "important" }],
    };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.questions).toHaveLength(1);
    expect(plan.constraints).toMatchObject([{ kind: "teammatePreference", weight: "important" }]);
  });

  it("drops teammate preferences when no teammates question comes with them", () => {
    const source: CopySource = {
      questions: [coding],
      constraints: [{ id: "c1", kind: "teammatePreference", weight: "important" }],
    };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.constraints).toEqual([]);
    expect(plan.skipped).toContainEqual({
      label: "Teammate preferences",
      reason: "no preferred-teammates question to go with it",
    });
  });

  it("does not add a second teammates question, but still honours the constraint", () => {
    // Only one is allowed, and the target already has one for the constraint to use.
    const target: CopyTarget = { questions: [{ ...mates, id: "existing" }], constraints: [] };
    const source: CopySource = {
      questions: [mates],
      constraints: [{ id: "c1", kind: "teammatePreference", weight: "nice" }],
    };
    const plan = planSurveyCopy(source, target, ids());
    expect(plan.questions).toEqual([]);
    expect(plan.constraints).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe("this session already has a preferred-teammates question");
  });

  it("skips project preferences until this session has a ranking question", () => {
    const source: CopySource = {
      questions: [],
      constraints: [{ id: "c1", kind: "projectPreference", weight: "important" }],
    };
    expect(planSurveyCopy(source, empty, ids()).constraints).toEqual([]);

    const withRanking: CopyTarget = { questions: [autoRanking], constraints: [] };
    expect(planSurveyCopy(source, withRanking, ids()).constraints).toHaveLength(1);
  });

  it("does not duplicate a constraint that can only be held once", () => {
    const target: CopyTarget = {
      questions: [autoRanking],
      constraints: [{ id: "existing", kind: "projectPreference", weight: "nice" }],
    };
    const source: CopySource = {
      questions: [],
      constraints: [{ id: "c1", kind: "projectPreference", weight: "must" }],
    };
    const plan = planSurveyCopy(source, target, ids());
    expect(plan.constraints).toEqual([]);
    expect(plan.skipped).toContainEqual({ label: "Project preferences", reason: "this session already has one" });
  });

  it("copies the same source twice without the two copies colliding", () => {
    // Ids are minted per copy, so applying one and then copying again produces a
    // second, independent set rather than overwriting the first.
    const source: CopySource = {
      questions: [coding],
      constraints: [{ id: "c1", kind: "balanceNumeric", weight: "nice", questionId: "q-coding" }],
    };
    const first = planSurveyCopy(source, empty, ids());
    const afterFirst: CopyTarget = { questions: first.questions, constraints: first.constraints };
    const second = planSurveyCopy(source, afterFirst, () => "second1");

    expect(first.questions[0].id).not.toBe(second.questions[0].id);
    expect(second.constraints[0]).toMatchObject({ questionId: "second1" });
  });

  it("keeps the weights the instructor chose", () => {
    const weights: Constraint["weight"][] = ["must", "important", "nice"];
    const source: CopySource = {
      questions: [work],
      constraints: weights.map((weight, i) => ({
        id: `c${i}`,
        kind: "alignCategory" as const,
        weight,
        questionId: "q-work",
      })),
    };
    const plan = planSurveyCopy(source, empty, ids());
    expect(plan.constraints.map((c) => c.weight)).toEqual(weights);
  });
});
