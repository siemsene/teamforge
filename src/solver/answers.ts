// Helpers for reading decrypted survey answers inside the solver/evaluator.
// NOTE: before answers reach the solver, teammate login codes have already
// been converted to student hashes by the decryption pipeline.

import type { Question, SurveyAnswers } from "../types";

export function hasValue(answer: SurveyAnswers[string] | undefined, value: string): boolean {
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return answer.includes(value);
  return String(answer) === value;
}

export function numericAnswer(answer: SurveyAnswers[string] | undefined): number {
  return typeof answer === "number" && Number.isFinite(answer) ? answer : 0;
}

/**
 * The answer as a number, or null where there isn't one.
 *
 * `numericAnswer` folds a missing answer into 0, which is fine for a threshold
 * test (0 never clears one) but wrong for an average: on a 1-5 scale, 0 sits
 * *below* the worst possible answer, so a student who never submitted would drag
 * their team's mean further than anyone who did. Balance constraints use this
 * instead and leave those students out of the arithmetic entirely.
 */
export function optionalNumericAnswer(answer: SurveyAnswers[string] | undefined): number | null {
  return typeof answer === "number" && Number.isFinite(answer) ? answer : null;
}

/** Ordered project ids the student ranked (empty slots removed). */
export function rankedProjects(answers: SurveyAnswers, questions: Question[]): string[] {
  const q = questions.find((qq) => qq.kind === "projectRanking");
  if (!q) return [];
  const v = answers[q.id];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

/** Hashes of the classmates this student asked to work with. */
export function teammateHashes(answers: SurveyAnswers, questions: Question[]): string[] {
  const q = questions.find((qq) => qq.kind === "teammates");
  if (!q) return [];
  const v = answers[q.id];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}
