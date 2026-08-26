// Client-side validation of a peer-evaluation form, per the published spec:
// Part 1 must allocate exactly 100 whole points across teammates (self
// excluded). An even split is the default and the neutral answer; any
// allocation far enough from it to actually move that teammate's factor needs
// one sentence of justification. Part 2 (when enabled) needs one 1-5 rating per
// behavior per teammate. Pure module - unit-testable.
//
// The justification threshold is the same dead band the factor uses, so the
// rule reads the same way to a student either way: inside the band nothing
// changes and nothing need be said; outside it, say why. Deriving it from the
// dead band rather than fixing it at absolute point values also means it scales
// with team size on its own, and that unavoidable integer rounding (34/33/33
// across three teammates) never demands an explanation.

import { DEFAULT_FACTOR_PARAMS, neutralShare } from "./teamFactor";
import type { PeerEvalAnswers } from "../types";

export interface EvalValidationConfig {
  includeBehaviors: boolean;
  behaviorCount: number;
  /** Defaults to the standard dead band when the session predates it. */
  deadband?: number;
}

/** The inclusive point range that needs no justification, for one teammate. */
export function neutralRange(
  teammateCount: number,
  deadband: number = DEFAULT_FACTOR_PARAMS.deadband,
): { low: number; high: number; neutral: number } {
  const neutral = neutralShare(teammateCount + 1);
  return {
    neutral,
    low: Math.ceil(neutral * (1 - deadband) - 1e-9),
    high: Math.floor(neutral * (1 + deadband) + 1e-9),
  };
}

/** True when the dead band leaves any room to deviate without explaining. */
export function justificationApplies(teammateCount: number): boolean {
  return teammateCount >= 2;
}

export function needsJustification(
  points: number,
  teammateCount: number,
  deadband: number = DEFAULT_FACTOR_PARAMS.deadband,
): boolean {
  if (!justificationApplies(teammateCount)) return false;
  const { low, high } = neutralRange(teammateCount, deadband);
  return points < low || points > high;
}

/**
 * Keeps only the justifications the submitted allocation actually calls for.
 *
 * The form renders a justification field only while an allocation sits outside
 * the dead band, so text attached to an in-band allocation is necessarily
 * left over from an earlier edit — the student cannot type it in that state.
 * Without this, revising a number back toward an even split still submitted the
 * stale sentence, and it surfaced in the instructor's detail CSV as if it
 * described the final answer.
 *
 * Pruning happens at submit rather than on every keystroke so a student who
 * nudges a value in and out of the band does not lose what they wrote.
 */
export function pruneJustifications(
  points: Record<string, number>,
  justifications: Record<string, string>,
  teammateCodeIndexes: number[],
  deadband: number = DEFAULT_FACTOR_PARAMS.deadband,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const idx of teammateCodeIndexes) {
    const key = String(idx);
    const text = justifications[key]?.trim();
    if (!text) continue;
    if (needsJustification(points[key], teammateCodeIndexes.length, deadband)) kept[key] = text;
  }
  return kept;
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
  const deadband = config.deadband ?? DEFAULT_FACTOR_PARAMS.deadband;
  const { low, high } = neutralRange(n, deadband);

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
    if (needsJustification(pts, n, deadband) && !answers.justifications[String(idx)]?.trim()) {
      problems.push(
        `An allocation outside ${low}-${high} needs one sentence of justification (teammate #${idx}).`,
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
