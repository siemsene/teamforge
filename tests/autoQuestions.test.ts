import { describe, expect, it } from "vitest";
import { syncAutoQuestions } from "../src/features/survey-builder/autoQuestions";
import { standardScaleOptions } from "../src/features/survey-builder/questionTemplates";
import type { Project, SingleChoiceQuestion } from "../src/types";

function project(requirements: Project["requirements"]): Project {
  return { id: "p1", name: "Project 1", description: "", requirements };
}

describe("syncAutoQuestions standard-scale seeding", () => {
  it("seeds a known attribute (major) from the standard scale, plus the required value", () => {
    const projects = [
      project([{ attributeKey: "major", attributeLabel: "Major", value: "Data Science", minCount: 1 }]),
    ];
    const result = syncAutoQuestions([], projects, false);
    const major = result.find((q) => q.attributeKey === "major") as SingleChoiceQuestion | undefined;

    expect(major).toBeDefined();
    // Standard options are present...
    for (const opt of standardScaleOptions("major")!) expect(major!.options).toContain(opt);
    // ...and the project's required value was appended (it wasn't in the scale).
    expect(major!.options).toContain("Data Science");
  });

  it("falls back to just the required values for an unknown attribute", () => {
    const projects = [
      project([
        { attributeKey: "programming-language", attributeLabel: "Programming language", value: "Rust", minCount: 1 },
      ]),
    ];
    const result = syncAutoQuestions([], projects, false);
    const q = result.find((x) => x.attributeKey === "programming-language") as SingleChoiceQuestion | undefined;

    expect(q).toBeDefined();
    expect(q!.options).toEqual(["Rust"]);
  });

  it("does not re-seed scale options into an existing auto question (respects edits)", () => {
    const existing: SingleChoiceQuestion = {
      id: "auto-attr-major",
      kind: "single",
      prompt: "What is your Major?",
      required: true,
      auto: true,
      attributeKey: "major",
      options: ["Computer Science"], // instructor trimmed it down
    };
    const projects = [
      project([{ attributeKey: "major", attributeLabel: "Major", value: "Computer Science", minCount: 1 }]),
    ];
    const result = syncAutoQuestions([existing], projects, false);
    const major = result.find((q) => q.attributeKey === "major") as SingleChoiceQuestion;

    // Only the requirement value remains; the full standard scale is not forced back in.
    expect(major.options).toEqual(["Computer Science"]);
  });
});
