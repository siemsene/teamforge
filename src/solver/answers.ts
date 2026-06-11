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
