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

/**
 * The inclusive point range that needs no justification, for one teammate.
 *
 * Widened where necessary to admit the even split itself. On a large team the
 * band in whole points can be narrower than the rounding it has to tolerate:
 * with 11 teammates the neutral share is 9.09, so a relative dead band gives
 * 9-9, yet 100 does not divide by 11 and somebody must receive 10. Without the
 * floor/ceil guard the form would open demanding a justification for an
 * allocation the student never chose.
 */
export function neutralRange(
  teammateCount: number,
  deadband: number = DEFAULT_FACTOR_PARAMS.deadband,
): { low: number; high: number; neutral: number } {
  const neutral = neutralShare(teammateCount + 1);
  return {
    neutral,
    low: Math.min(Math.floor(neutral), Math.ceil(neutral * (1 - deadband) - 1e-9)),
    high: Math.max(Math.ceil(neutral), Math.floor(neutral * (1 + deadband) + 1e-9)),
  };
}

/**
 * The even split of 100 points, handing the remainder out one point at a time.
 *
 * This is what the form opens on, so it must never itself fall outside the
 * dead band — a form that demanded a justification for its own default would
 * be absurd. `tests/evalValidation.test.ts` pins that across team sizes.
 */
export function evenSplit(teammateCodeIndexes: number[]): Record<string, number> {
  const each = Math.floor(100 / teammateCodeIndexes.length);
  let remainder = 100 - each * teammateCodeIndexes.length;
  const out: Record<string, number> = {};
  for (const idx of teammateCodeIndexes) {
    const bump = remainder > 0 ? 1 : 0;
    remainder -= bump;
    out[String(idx)] = each + bump;
  }
  return out;
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
  // Tolerate missing objects. This also runs against decrypted ballots, which
  // are only as well-formed as whoever wrote them (see validateSubmittedBallot).
  const points = answers.points ?? {};
  const justifications = answers.justifications ?? {};
  const deadband = config.deadband ?? DEFAULT_FACTOR_PARAMS.deadband;
  const { low, high } = neutralRange(n, deadband);

  let total = 0;
  for (const idx of teammateCodeIndexes) {
    const pts = points[String(idx)];
    if (typeof pts !== "number" || Number.isNaN(pts)) {
      problems.push(`Missing a point allocation for teammate #${idx}.`);
      continue;
    }
    if (!Number.isInteger(pts)) problems.push(`Points for teammate #${idx} must be a whole number.`);
    if (pts < 0 || pts > 100) problems.push(`Points for teammate #${idx} must be between 0 and 100.`);
    total += pts;
    if (needsJustification(pts, n, deadband) && !justifications[String(idx)]?.trim()) {
      problems.push(
        `An allocation outside ${low}-${high} needs one sentence of justification (teammate #${idx}).`,
      );
    }
  }
  const extra = Object.keys(points).filter((k) => !teammateCodeIndexes.includes(Number(k)));
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

/**
 * Re-checks a *decrypted* ballot on the instructor's side.
 *
 * The student's form validates before submitting, but that is the only place it
 * happens: submissions are ECIES-encrypted, so the security rules can only
 * check the envelope's shape, never its contents. Anyone willing to open a
 * console can post a ballot that allocates 400 points, or negative ones, and
 * `computeTeamFactors` would fold it into every teammate's grade.
 *
 * So the same rules run again here, against the roster the instructor holds
 * rather than against anything the ballot claims about itself. `raterCodeIndex`
 * and `teamLabel` are checked too — a ballot is only ever read from the doc of
 * the student it belongs to, so a mismatch means the payload was hand-made.
 */
export function validateSubmittedBallot(
  answers: PeerEvalAnswers,
  expected: { raterCodeIndex: number; teammateCodeIndexes: number[]; teamLabel: string },
  config: EvalValidationConfig,
): string[] {
  const problems: string[] = [];
  if (answers.raterCodeIndex !== expected.raterCodeIndex) {
    problems.push(
      `Ballot claims to be from #${answers.raterCodeIndex} but was submitted by #${expected.raterCodeIndex}.`,
    );
  }
  if (answers.teamLabel !== expected.teamLabel) {
    problems.push(`Ballot names team "${answers.teamLabel}" but the rater is on "${expected.teamLabel}".`);
  }
  if (!answers.points || typeof answers.points !== "object") {
    return [...problems, "Ballot carries no point allocation."];
  }
  return [...problems, ...validatePeerEval(answers, expected.teammateCodeIndexes, config)];
}

/**
 * A ballot restricted to the teammates who are still on the team.
 *
 * A student can leave mid-round. Their teammates' ballots were written against
 * the roster as it stood, so they allocate part of their 100 points to someone
 * who is now gone. Scoring those ballots as-is would read every surviving
 * allocation against a *smaller* even split and drag the whole team down;
 * rejecting them (which is what used to happen) threw away the team's real
 * ratings entirely and imputed an even split for everyone.
 *
 * So: drop the departed allocations and scale the rest back up to 100. That
 * preserves exactly what the rater expressed about the people still there —
 * 40:30 stays 40:30 — and leaves the factor formula itself untouched.
 *
 * This runs *after* validation, never before. Validation compares a ballot
 * against the roster it was written for; renormalizing first would make the
 * justification rule fire on numbers the student never typed (60/20/20 becomes
 * 75/25, outside the two-teammate dead band, with no justification attached) and
 * the ballot would be rejected for the app's own arithmetic.
 */
export interface ReconciledBallot {
  /** The ballot as it should be scored. Deep-equal to the input when nothing
   * was dropped, so the ordinary path is provably untouched. */
  answers: PeerEvalAnswers;
  dropped: { codeIndex: number; points: number }[];
  /** Every surviving allocation was zero (or there is nobody left to rate), so
   * there is no relative judgment to preserve. The caller must impute an even
   * split rather than scale by zero. */
  noOpinion: boolean;
}

/**
 * Exact proportional shares — deliberately *not* rounded to whole points.
 *
 * Rounding here amplifies the rounding already in the ballot. On a team of nine,
 * an even split is 13/13/13/13/12/12/12/12; drop one teammate and
 * largest-remainder apportionment turns that into 15/15/15/15/14/13/13, and 13
 * against a neutral share of 14.29 is 0.91 — outside the dead band. A rater who
 * accepted the form's default would have pushed two teammates below 1.00, which
 * is precisely what the dead band exists to prevent.
 *
 * Exact shares keep every survivor inside the band: 12/88 of 100 is 13.64, or
 * 0.954 of neutral. The whole-number rule is not weakened by this, because the
 * reconciled ballot is never validated — validation runs first, against the raw
 * ballot — and the instructor's detail CSV exports the raw ballot too. The only
 * consumer of these numbers is computeTeamFactors, which divides by the neutral
 * share and wants the exact value.
 */
export function reconcileBallot(
  answers: PeerEvalAnswers,
  teammateCodeIndexes: number[],
): ReconciledBallot {
  const current = new Set(teammateCodeIndexes.map(String));
  const points = answers.points ?? {};
  const dropped: { codeIndex: number; points: number }[] = [];
  for (const [key, value] of Object.entries(points)) {
    if (current.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      dropped.push({ codeIndex: Number(key), points: value });
    }
  }
  if (dropped.length === 0) return { answers, dropped: [], noOpinion: false };

  const surviving = teammateCodeIndexes
    .map((idx) => ({ codeIndex: idx, value: points[String(idx)] }))
    .filter((p): p is { codeIndex: number; value: number } =>
      typeof p.value === "number" && Number.isFinite(p.value),
    );
  const total = surviving.reduce((a, p) => a + p.value, 0);
  dropped.sort((a, b) => a.codeIndex - b.codeIndex);
  if (surviving.length === 0 || total <= 0) {
    return { answers, dropped, noOpinion: true };
  }

  const nextPoints: Record<string, number> = {};
  for (const p of surviving) nextPoints[String(p.codeIndex)] = (p.value * 100) / total;

  // Justifications survive verbatim. Re-pruning them against the renormalized
  // numbers would delete a sentence the student wrote, because our own
  // arithmetic moved the value back inside the dead band.
  const justifications: Record<string, string> = {};
  for (const idx of teammateCodeIndexes) {
    const text = answers.justifications?.[String(idx)];
    if (text) justifications[String(idx)] = text;
  }

  // Behaviour ratings are absolute 1-5 judgments, not a budget: pruned to the
  // remaining teammates, never rescaled.
  let behaviorRatings: Record<string, number[]> | undefined;
  if (answers.behaviorRatings) {
    behaviorRatings = {};
    for (const idx of teammateCodeIndexes) {
      const r = answers.behaviorRatings[String(idx)];
      if (r) behaviorRatings[String(idx)] = r;
    }
  }

  return {
    answers: { ...answers, points: nextPoints, justifications, behaviorRatings },
    dropped,
    noOpinion: false,
  };
}
