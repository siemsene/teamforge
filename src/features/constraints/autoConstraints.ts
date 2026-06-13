// Keeps the umbrella "project requirements" constraint in sync with the
// projects defined on the Projects tab: it exists (and is weightable alongside
// the others) exactly when there are attribute requirements to enforce.

import { randomId } from "../../lib/util";
import type { Constraint, Project } from "../../types";

/**
 * Returns the constraint list with a single projectRequirements constraint
 * present iff there are project requirements to enforce. Preserves an existing
 * one (and its weight); returns the SAME array reference when nothing changes,
 * so callers can skip a write with a cheap identity check.
 */
export function syncProjectRequirementsConstraint(
  constraints: Constraint[],
  projects: Project[],
  genericProjects: boolean,
): Constraint[] {
  const hasRequirements = !genericProjects && projects.some((p) => p.requirements.length > 0);
  const existing = constraints.find((c) => c.kind === "projectRequirements");

  if (hasRequirements && !existing) {
    // Default to "must": requirements are usually hard. Editable afterwards.
    return [{ id: randomId(8), kind: "projectRequirements", weight: "must" }, ...constraints];
  }
  if (!hasRequirements && existing) {
    return constraints.filter((c) => c.kind !== "projectRequirements");
  }
  return constraints;
}
