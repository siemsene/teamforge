import { describe, expect, it } from "vitest";
import { syncProjectRequirementsConstraint } from "../src/features/constraints/autoConstraints";
import type { Constraint, Project } from "../src/types";

const proj = (requirements: Project["requirements"]): Project => ({
  id: "p",
  name: "P",
  description: "",
  requirements,
});
const REQ = { attributeKey: "major", attributeLabel: "Major", value: "Computer Science", minCount: 1 };

describe("syncProjectRequirementsConstraint", () => {
  it("adds a must-weight umbrella when requirements exist and none is present", () => {
    const out = syncProjectRequirementsConstraint([], [proj([REQ])], false);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("projectRequirements");
    expect(out[0].weight).toBe("must");
  });

  it("removes the umbrella when no requirements remain", () => {
    const existing: Constraint = { id: "x", kind: "projectRequirements", weight: "nice" };
    const out = syncProjectRequirementsConstraint([existing], [proj([])], false);
    expect(out.some((c) => c.kind === "projectRequirements")).toBe(false);
  });

  it("does not add the umbrella for generic-project sessions", () => {
    expect(syncProjectRequirementsConstraint([], [proj([REQ])], true)).toHaveLength(0);
  });

  it("returns the same array reference (no write) when nothing changes", () => {
    const withUmbrella: Constraint[] = [{ id: "x", kind: "projectRequirements", weight: "important" }];
    expect(syncProjectRequirementsConstraint(withUmbrella, [proj([REQ])], false)).toBe(withUmbrella);

    const none: Constraint[] = [];
    expect(syncProjectRequirementsConstraint(none, [proj([])], false)).toBe(none);
  });

  it("preserves an existing umbrella's weight rather than duplicating it", () => {
    const existing: Constraint[] = [{ id: "x", kind: "projectRequirements", weight: "important" }];
    const out = syncProjectRequirementsConstraint(existing, [proj([REQ])], false);
    expect(out.filter((c) => c.kind === "projectRequirements")).toHaveLength(1);
    expect(out[0].weight).toBe("important");
  });
});
