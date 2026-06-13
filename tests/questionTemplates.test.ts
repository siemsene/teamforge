import { describe, expect, it } from "vitest";
import {
  QUESTION_TEMPLATES,
  TEMPLATE_CATEGORIES,
  standardScaleOptions,
} from "../src/features/survey-builder/questionTemplates";

describe("question templates catalog", () => {
  it("has unique template ids", () => {
    const ids = QUESTION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses known categories and has non-empty labels/prompts", () => {
    for (const t of QUESTION_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("choice templates have at least two distinct, non-empty options", () => {
    for (const t of QUESTION_TEMPLATES) {
      if (t.body.kind !== "single" && t.body.kind !== "multi") continue;
      const opts = t.body.options;
      expect(opts.length, t.id).toBeGreaterThanOrEqual(2);
      expect(opts.every((o) => o.trim().length > 0), t.id).toBe(true);
      expect(new Set(opts).size, t.id).toBe(opts.length);
    }
  });

  it("numeric templates have min<max and one label per point", () => {
    for (const t of QUESTION_TEMPLATES) {
      if (t.body.kind !== "number") continue;
      expect(t.body.min, t.id).toBeLessThan(t.body.max);
      expect(t.body.labels.length, t.id).toBe(t.body.max - t.body.min + 1);
      expect(t.body.labels.every((l) => l.trim().length > 0), t.id).toBe(true);
    }
  });

  it("only single-choice templates carry an attributeKey, and they are unique", () => {
    const keys: string[] = [];
    for (const t of QUESTION_TEMPLATES) {
      if (t.attributeKey === undefined) continue;
      expect(t.body.kind, t.id).toBe("single");
      keys.push(t.attributeKey);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes a teammates template, and teammates templates have a positive maxCodes", () => {
    const teammates = QUESTION_TEMPLATES.filter((t) => t.body.kind === "teammates");
    expect(teammates.length).toBeGreaterThan(0);
    for (const t of teammates) {
      if (t.body.kind !== "teammates") continue;
      expect(t.body.maxCodes, t.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("standardScaleOptions resolves a tagged attribute and returns its options", () => {
    const major = standardScaleOptions("major");
    expect(major).toBeDefined();
    expect(major).toContain("Computer Science");
    expect(standardScaleOptions("no-such-attribute")).toBeUndefined();
  });
});
