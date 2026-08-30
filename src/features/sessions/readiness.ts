import { autoQuestionId } from "../survey-builder/autoQuestions";
import type { Project, PublicConfig, Question, SessionDoc } from "../../types";

export interface ReadinessItem {
  id: string;
  label: string;
  ok: boolean;
  severity: "blocker" | "warning";
  detail?: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
}

function findQuestion(questions: Question[], id: string): Question | undefined {
  return questions.find((q) => q.id === id);
}

/**
 * `studentCount` is passed in rather than read off session.numStudents: students
 * can be added and removed after creation, and the capacity check has to be
 * about the roster that exists, not the number the session was created with.
 * Callers that have the live list pass its length; the default keeps older
 * callers (and tests) working off the stored count.
 */
export function getSessionReadiness(
  session: SessionDoc,
  publicConfig: PublicConfig,
  projects: Project[],
  studentCount: number = session.numStudents,
): ReadinessReport {
  const items: ReadinessItem[] = [];
  const teamCount = session.genericProjects ? session.numTeams : projects.length;
  const teams = session.genericProjects
    ? Array.from({ length: session.numTeams }, () => ({
        minSize: session.minTeamSize,
        maxSize: session.maxTeamSize,
      }))
    : projects.map((p) => ({
        minSize: p.minSize ?? session.minTeamSize,
        maxSize: p.maxSize ?? session.maxTeamSize,
      }));
  const minCapacity = teams.reduce((n, t) => n + t.minSize, 0);
  const maxCapacity = teams.reduce((n, t) => n + t.maxSize, 0);
  const hasRanking = publicConfig.questions.some((q) => q.kind === "projectRanking");
  const hasTeammates = publicConfig.questions.some((q) => q.kind === "teammates");

  items.push({
    id: "teams",
    label: session.genericProjects ? "Generic teams configured" : "Projects configured",
    ok: teamCount > 0,
    severity: "blocker",
    detail: session.genericProjects
      ? `${teamCount} team${teamCount === 1 ? "" : "s"}`
      : teamCount > 0
        ? `${teamCount} project${teamCount === 1 ? "" : "s"}`
        : "Add at least one project before opening the survey.",
  });

  items.push({
    id: "capacity",
    label: "Team capacity fits enrollment",
    ok: teamCount > 0 && minCapacity <= studentCount && maxCapacity >= studentCount,
    severity: "blocker",
    detail:
      teamCount === 0
        ? "No teams are available yet."
        : `${studentCount} students; capacity range ${minCapacity}-${maxCapacity}.`,
  });

  items.push({
    id: "questions",
    label: "Survey has questions",
    ok: publicConfig.questions.length > 0,
    severity: "blocker",
    detail:
      publicConfig.questions.length > 0
        ? `${publicConfig.questions.length} question${publicConfig.questions.length === 1 ? "" : "s"}`
        : "Add at least one question so the optimizer has data to use.",
  });

  if (!session.genericProjects) {
    items.push({
      id: "project-ranking",
      label: "Project ranking question present",
      ok: projects.length === 0 || hasRanking,
      severity: "blocker",
      detail: hasRanking ? "Students can rank project preferences." : "Project sessions need a ranking question.",
    });
  }

  const missingRequirementOptions: string[] = [];
  for (const p of projects) {
    for (const req of p.requirements) {
      const q = findQuestion(publicConfig.questions, autoQuestionId(req.attributeKey));
      if (!q || q.kind !== "single" || !q.options.includes(req.value)) {
        missingRequirementOptions.push(`${p.name}: ${req.attributeLabel} = ${req.value}`);
      }
    }
  }
  items.push({
    id: "requirements",
    label: "Project requirement options are answerable",
    ok: missingRequirementOptions.length === 0,
    severity: "blocker",
    detail:
      missingRequirementOptions.length === 0
        ? "Every requirement value appears in the student survey."
        : missingRequirementOptions.join("; "),
  });

  const invalidConstraints: string[] = [];
  for (const c of session.constraints) {
    if (c.kind === "antiIsolation") {
      const q = findQuestion(publicConfig.questions, c.questionId);
      if (!q || (q.kind !== "single" && q.kind !== "multi")) invalidConstraints.push("Anti-isolation");
    }
    if (c.kind === "balanceNumeric" || c.kind === "minCapability") {
      const q = findQuestion(publicConfig.questions, c.questionId);
      if (!q || q.kind !== "number") invalidConstraints.push(c.kind === "balanceNumeric" ? "Numeric balance" : "Capability coverage");
    }
    if (c.kind === "projectPreference" && !hasRanking) invalidConstraints.push("Project preference");
    if (c.kind === "teammatePreference" && !hasTeammates) invalidConstraints.push("Teammate preference");
  }
  items.push({
    id: "constraints",
    label: "Constraints reference existing questions",
    ok: invalidConstraints.length === 0,
    severity: "blocker",
    detail:
      invalidConstraints.length === 0
        ? `${session.constraints.length} constraint${session.constraints.length === 1 ? "" : "s"} ready`
        : `Fix or remove: ${invalidConstraints.join(", ")}`,
  });

  items.push({
    id: "constraints-present",
    label: "Optimization goals defined",
    ok: session.constraints.length > 0,
    severity: "warning",
    detail:
      session.constraints.length > 0
        ? "The optimizer has goals beyond team size."
        : "Without constraints, the optimizer only balances team sizes.",
  });

  return {
    items,
    blockers: items.filter((i) => !i.ok && i.severity === "blocker"),
    warnings: items.filter((i) => !i.ok && i.severity === "warning"),
  };
}
