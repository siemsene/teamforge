// Client-side validation of a peer-evaluation form, per the published spec:
// Part 1 must allocate exactly 100 whole points across teammates (self
// excluded), with a one-sentence justification for any allocation below 15 or
// above 40; Part 2 (when enabled) needs one 1-5 rating per behavior per
// teammate. Pure module - unit-testable.

import type { PeerEvalAnswers } from "../types";

export const JUSTIFICATION_LOW = 15;
export const JUSTIFICATION_HIGH = 40;

export interface EvalValidationConfig {
  includeBehaviors: boolean;
  behaviorCount: number;
}

/** True when the justification thresholds are meaningful for this team size.
 * With one or two teammates the neutral share (100 or 50) already lies outside
 * [15, 40], so the thresholds would demand a justification for the only honest
 * answer - they are waived. */
export function justificationApplies(teammateCount: number): boolean {
  if (teammateCount < 1) return false;
  const neutral = 100 / teammateCount;
  return neutral >= JUSTIFICATION_LOW && neutral <= JUSTIFICATION_HIGH;
}

export function needsJustification(points: number, teammateCount: number): boolean {
  return justificationApplies(teammateCount) && (points < JUSTIFICATION_LOW || points > JUSTIFICATION_HIGH);
}

/** Returns a list of human-readable problems; empty means the form is valid. */
export function validatePeerEval(
  answers: PeerEvalAnswers,
  teammateCodeIndexes: number[],
  config: EvalValidationConfig,
): string[] {
  const problems: string[] = [];
  const n = teammateCodeIndexes.length;
  if (n === 0) return ["You have no teammates to evaluate."];

  let total = 0;
  for (const idx of teammateCodeIndexes) {
    const pts = answers.points[String(idx)];
    if (typeof pts !== "number" || Number.isNaN(pts)) {
      problems.push(`Missing a point allocation for teammate #${idx}.`);
      continue;
    }
    if (!Number.isInteger(pts)) problems.push(`Points for teammate #${idx} must be a whole number.`);
    if (pts < 0 || pts > 100) problems.push(`Points for teammate #${idx} must be between 0 and 100.`);
    total += pts;
    if (needsJustification(pts, n) && !answers.justifications[String(idx)]?.trim()) {
      problems.push(
        `An allocation below ${JUSTIFICATION_LOW} or above ${JUSTIFICATION_HIGH} needs one sentence of justification (teammate #${idx}).`,
      );
    }
  }
  const extra = Object.keys(answers.points).filter((k) => !teammateCodeIndexes.includes(Number(k)));
  if (extra.length > 0) problems.push("Points were allocated to someone who is not a teammate.");
  if (total !== 100) problems.push(`Points must sum to exactly 100 (currently ${total}).`);

  if (config.includeBehaviors) {
    for (const idx of teammateCodeIndexes) {
      const ratings = answers.behaviorRatings?.[String(idx)];
      if (!ratings || ratings.length !== config.behaviorCount) {
        problems.push(`Missing behavior ratings for teammate #${idx}.`);
        continue;
      }
      if (ratings.some((r) => !Number.isInteger(r) || r < 1 || r > 5)) {
        problems.push(`Behavior ratings for teammate #${idx} must be whole numbers from 1 to 5.`);
      }
    }
  }
  return problems;
}
