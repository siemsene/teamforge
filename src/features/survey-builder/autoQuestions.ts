// Keeps the survey in sync with project definitions (requirement 3->4):
// every attribute referenced by a project requirement gets a categorical
// survey question, and sessions with named projects get a ranking question.

import type { Project, Question, SingleChoiceQuestion } from "../../types";

export const PROJECT_RANKING_ID = "auto-project-ranking";

export function autoQuestionId(attributeKey: string): string {
  return `auto-attr-${attributeKey}`;
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Returns the updated question list: auto questions added/updated for current
 * requirements, stale auto questions removed, manual questions untouched
 * (including manual edits to auto question options — options are merged).
 */
export function syncAutoQuestions(questions: Question[], projects: Project[], genericProjects: boolean): Question[] {
  const result: Question[] = [];
  const requirements = projects.flatMap((p) => p.requirements);
  const byAttribute = new Map<string, { label: string; values: Set<string> }>();
  for (const req of requirements) {
    const entry = byAttribute.get(req.attributeKey) ?? { label: req.attributeLabel, values: new Set<string>() };
    entry.values.add(req.value);
    byAttribute.set(req.attributeKey, entry);
  }

  for (const q of questions) {
    if (q.auto && q.kind === "single" && q.attributeKey) {
      const entry = byAttribute.get(q.attributeKey);
      if (!entry) continue; // requirement gone -> drop the auto question
      // Merge any new requirement values into the options, keep instructor additions.
      const options = [...q.options];
      for (const v of entry.values) if (!options.includes(v)) options.push(v);
      result.push({ ...q, options });
      byAttribute.delete(q.attributeKey);
      continue;
    }
    if (q.auto && q.kind === "projectRanking") {
      if (genericProjects || projects.length === 0) continue; // no longer applicable
      result.push({ ...q, rankCount: Math.min(q.rankCount, projects.length) });
      continue;
    }
    result.push(q);
  }

  // New attributes that have no question yet.
  for (const [key, entry] of byAttribute) {
    const q: SingleChoiceQuestion = {
      id: autoQuestionId(key),
      kind: "single",
      prompt: `What is your ${entry.label}?`,
      required: true,
      auto: true,
      attributeKey: key,
      options: [...entry.values],
    };
    result.push(q);
  }

  // Ranking question when there are named projects and none exists yet.
  const hasRanking = result.some((q) => q.kind === "projectRanking");
  if (!genericProjects && projects.length > 0 && !hasRanking) {
    result.push({
      id: PROJECT_RANKING_ID,
      kind: "projectRanking",
      prompt: "Rank the projects you would most like to work on.",
      required: true,
      auto: true,
      rankCount: Math.min(3, projects.length),
    });
  }

  return result;
}
