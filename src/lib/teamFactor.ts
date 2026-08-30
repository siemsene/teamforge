// Team-factor computation for peer evaluations.
//
// Everything is expressed in *shares* rather than raw points, so an even split
// is exactly 1.00 no matter how large the team is:
//
//   - Each rater allocates 100 points across teammates (self excluded). An even
//     split is the default answer and the reference point.
//   - A teammate's share of one ballot is their points divided by the even
//     split, nu = 100 / (n - 1). Allocating evenly gives everyone a share of 1.
//   - A member who did not submit is treated as having split evenly. Without
//     this, missing ballots raise everyone else's bar while leaving the
//     non-submitter's alone, so skipping the form pays.
//   - Of the shares you received, the highest and the lowest are dropped before
//     averaging (needs three or more real raters; imputed shares are never
//     dropped). Trimming both ends neutralises a lone hostile rater *and* a
//     lone generous one.
//   - Your trimmed mean share r becomes a factor through a dead band, damping
//     and deliberately asymmetric caps:
//
//         d = r - 1
//         f = clip(1 + k * sgn(d) * max(0, |d| - delta), floor, ceiling)
//
//     The dead band means ordinary noise and unavoidable integer rounding move
//     nobody's grade. The caps are asymmetric on purpose (default 0.70-1.05):
//     gains are small and losses are not, so a group cannot profit by agreeing
//     to sink one member - the arithmetic makes that play negative-sum.
//
// The team mean is therefore *not* forced to 1.00. It lands on exactly 1.00
// whenever a team has no real dispersion, and falls below 1.00 only when
// somebody genuinely under-contributed. That drop is reported to the
// instructor, never silently corrected away.
//
// Pure module - no Firestore, no crypto - so it is directly unit-testable.

import type { PeerEvalAnswers } from "../types";

export interface FactorParams {
  factorFloor: number;
  factorCeiling: number;
  /** |share − 1| at or below this maps to exactly 1.00. */
  deadband: number;
  /** Damping on the share deviation beyond the dead band. */
  damping: number;
}

export const DEFAULT_FACTOR_PARAMS: FactorParams = {
  factorFloor: 0.7,
  factorCeiling: 1.05,
  deadband: 0.08,
  damping: 0.5,
};

/** Factors below this trigger an instructor conversation before grades. */
export const LOW_FACTOR_FLAG = 0.9;
/** Teams whose factors spread further than this are flagged. */
export const SPREAD_FLAG = 0.2;
/** Fewest real raters that still leaves a value after trimming both ends. */
export const MIN_RATERS_TO_TRIM = 3;
/**
 * Fewest real raters before a factor may be published back to the student.
 *
 * `shareToFactor` is invertible outside the dead band, so a published factor is
 * a published share. With one real ballot that share *is* that teammate's
 * allocation, and the student can read it straight off — which is exactly what
 * the anonymity guard on `share` exists to prevent. Below this the student is
 * shown 1.00 and told why; the instructor still sees the computed value.
 */
export const MIN_RATERS_TO_PUBLISH = 2;
/** Fewest real raters before per-share detail is returned to the student. */
export const MIN_RATERS_FOR_DETAIL = 3;

/**
 * Fills in defaults for configs written before the dead band existed, so old
 * sessions keep computing rather than producing NaN.
 */
export function resolveFactorParams(config: {
  factorFloor: number;
  factorCeiling: number;
  deadband?: number;
  damping?: number;
}): FactorParams {
  return {
    factorFloor: config.factorFloor,
    factorCeiling: config.factorCeiling,
    deadband: config.deadband ?? DEFAULT_FACTOR_PARAMS.deadband,
    damping: config.damping ?? DEFAULT_FACTOR_PARAMS.damping,
  };
}

/** Points one rater gives each teammate at an even split. */
export function neutralShare(teamSize: number): number {
  return teamSize > 1 ? 100 / (teamSize - 1) : 100;
}

export interface TeamEvalInput {
  teamLabel: string;
  /** Every member's codeIndex — determines team size and who can be rated. */
  memberCodeIndexes: number[];
  /** Submitted evaluations from this team's members. */
  submissions: PeerEvalAnswers[];
  /**
   * Members who submitted a ballot that carried no usable opinion — everything
   * they allocated went to teammates who have since left. An even split is
   * imputed for them, as for silence, but they did submit, so `noSubmission`
   * must not fire against them.
   */
  submittedButNeutralized?: number[];
}

// A note for whoever is tempted to reconcile ballots *here* rather than before
// calling: don't. public/peer-eval-team-factor.xlsx models this module's
// arithmetic and is published to students as a live worked example, so anything
// added here has to be added there too. Restricting a ballot to the teammates
// still on the team is a property of the ballot, not of the factor, and lives in
// reconcileBallot (lib/evalValidation.ts).

/** One received rating, normalised so an even split is 1.00. */
export interface ReceivedShare {
  share: number;
  /** True when this stands in for a teammate who did not submit. */
  imputed: boolean;
}

export interface MemberFactorResult {
  codeIndex: number;
  /** Points received, one per submitting teammate (imputed ones excluded). */
  receivedPoints: number[];
  /** Every share received, imputed ones included, before trimming. */
  receivedShares: ReceivedShare[];
  /** Number of teammates who actually submitted. Gates the anonymity guard. */
  raterCount: number;
  /** Even-split ballots stood in for teammates who did not submit. */
  imputedCount: number;
  /** 100 / (teamSize − 1). */
  neutralShare: number;
  /** Shares removed by the trim, or null where the trim did not apply. */
  trimmedLow: number | null;
  trimmedHigh: number | null;
  /** Trimmed mean of the shares received; 1.00 is an even split. */
  share: number;
  factor: number;
  /** Per-behavior mean of ratings received (index-aligned with config.behaviors). */
  behaviorAverages: number[] | null;
  flags: MemberFlag[];
}

export type MemberFlag = "lowFactor" | "noRatings" | "noSubmission" | "unanimousLow";

export interface TeamFactorResult {
  teamLabel: string;
  members: MemberFactorResult[];
  /** max(factor) - min(factor) across the team. */
  spread: number;
  spreadFlagged: boolean;
  /** Mean factor across the team. Exactly 1 absent real dispersion. */
  teamMean: number;
}

/**
 * Drops the highest and the lowest received share. Imputed shares stand in for
 * a silent teammate rather than expressing an opinion, so they are never the
 * ones dropped — and were they eligible they would be chosen almost every time,
 * since they sit at exactly 1.00 while the real shares cluster elsewhere.
 *
 * Needs three or more real shares: trimming both ends of three leaves the
 * median, which is still enough to absorb one hostile or one generous rater.
 * Below that there is nothing safe to drop.
 */
export function trimEnds(received: ReceivedShare[]): {
  kept: ReceivedShare[];
  trimmedLow: number | null;
  trimmedHigh: number | null;
} {
  const real = received.filter((r) => !r.imputed);
  if (real.length < MIN_RATERS_TO_TRIM) {
    return { kept: received, trimmedLow: null, trimmedHigh: null };
  }
  const sorted = [...real].sort((a, b) => a.share - b.share);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return {
    kept: [...sorted.slice(1, -1), ...received.filter((r) => r.imputed)],
    trimmedLow: low.share,
    trimmedHigh: high.share,
  };
}

/**
 * Maps a trimmed mean share onto a grade factor: dead band, then damping, then
 * asymmetric caps. Deviations within the dead band return exactly 1.
 */
export function shareToFactor(share: number, params: FactorParams): number {
  const d = share - 1;
  const beyond = Math.max(0, Math.abs(d) - params.deadband);
  const raw = 1 + params.damping * Math.sign(d) * beyond;
  return Math.min(params.factorCeiling, Math.max(params.factorFloor, raw));
}

/**
 * Whether the caps make coordinated scapegoating a losing move on a team of
 * this size.
 *
 * The play is n-1 members agreeing to sink the last one. Each of them can gain
 * at most `ceiling - 1`; the target can lose at most `1 - floor`. So the play is
 * negative-sum exactly while
 *
 *     (n - 1) * (ceiling - 1)  <  (1 - floor)
 *
 * which is a statement about team size, not only about the caps. At the
 * defaults (1.05 / 0.70) it holds comfortably at five and breaks at eight, so a
 * claim made without reference to n is not a claim that can be relied on.
 */
export function scapegoatingIsNegativeSum(teamSize: number, params: FactorParams): boolean {
  return (teamSize - 1) * (params.factorCeiling - 1) < 1 - params.factorFloor;
}

/** Largest team for which `scapegoatingIsNegativeSum` still holds. */
export function maxTeamSizeForNegativeSum(params: FactorParams): number {
  const gain = params.factorCeiling - 1;
  if (gain <= 0) return Infinity;
  // Largest n with (n-1) * gain < (1 - floor).
  const loss = 1 - params.factorFloor;
  return Math.max(1, Math.ceil(loss / gain));
}

/** How tightly clustered received shares must be to read as coordinated. */
const UNANIMITY_TOLERANCE = 0.05;

/**
 * Fires when a member is rated below the dead band by everyone *and* the
 * ratings barely differ. Raters independently sizing up a real free rider
 * produce scattered numbers; people who agreed on a figure beforehand produce
 * near-identical ones. It cannot tell those two apart — both warrant the same
 * conversation, which is why it is not called "collusion".
 */
function isUnanimousLow(received: ReceivedShare[], share: number, params: FactorParams): boolean {
  const real = received.filter((r) => !r.imputed).map((r) => r.share);
  if (real.length < 2 || share >= 1 - params.deadband) return false;
  return Math.max(...real) - Math.min(...real) <= UNANIMITY_TOLERANCE;
}

export function computeMemberFactor(
  received: ReceivedShare[],
  params: FactorParams,
): Pick<
  MemberFactorResult,
  "receivedShares" | "trimmedLow" | "trimmedHigh" | "share" | "factor" | "flags"
> {
  if (received.length === 0) {
    return {
      receivedShares: received,
      trimmedLow: null,
      trimmedHigh: null,
      share: 1,
      factor: 1,
      flags: ["noRatings"],
    };
  }
  const { kept, trimmedLow, trimmedHigh } = trimEnds(received);
  const share = kept.reduce((a, b) => a + b.share, 0) / kept.length;
  const factor = shareToFactor(share, params);
  const flags: MemberFlag[] = [];
  if (factor < LOW_FACTOR_FLAG) flags.push("lowFactor");
  if (isUnanimousLow(received, share, params)) flags.push("unanimousLow");
  return { receivedShares: received, trimmedLow, trimmedHigh, share, factor, flags };
}

export function computeTeamFactors(team: TeamEvalInput, params: FactorParams): TeamFactorResult {
  const teamSize = team.memberCodeIndexes.length;
  const neutral = neutralShare(teamSize);
  const submitted = new Set([
    ...team.submissions
      .filter((s) => team.memberCodeIndexes.includes(s.raterCodeIndex))
      .map((s) => s.raterCodeIndex),
    ...(team.submittedButNeutralized ?? []),
  ]);

  const members: MemberFactorResult[] = team.memberCodeIndexes.map((ratee) => {
    const received: ReceivedShare[] = [];
    const receivedPoints: number[] = [];
    const behaviorSums: number[] = [];
    const behaviorCounts: number[] = [];
    let raterCount = 0;
    let imputedCount = 0;

    for (const rater of team.memberCodeIndexes) {
      if (rater === ratee) continue;
      const sub = team.submissions.find((s) => s.raterCodeIndex === rater);
      const pts = sub?.points[String(ratee)];
      if (typeof pts !== "number" || !Number.isFinite(pts)) {
        // Silent teammate, or one whose ballot omitted this ratee: assume they
        // would have split evenly. Every member always has n − 1 shares, which
        // is what keeps a missing ballot from moving anyone's bar.
        received.push({ share: 1, imputed: true });
        imputedCount += 1;
        continue;
      }
      received.push({ share: pts / neutral, imputed: false });
      receivedPoints.push(pts);
      raterCount += 1;
      const ratings = sub?.behaviorRatings?.[String(ratee)];
      if (ratings) {
        ratings.forEach((r, i) => {
          behaviorSums[i] = (behaviorSums[i] ?? 0) + r;
          behaviorCounts[i] = (behaviorCounts[i] ?? 0) + 1;
        });
      }
    }

    const behaviorAverages =
      behaviorCounts.length > 0 ? behaviorSums.map((s, i) => s / behaviorCounts[i]) : null;
    const scored = computeMemberFactor(received, params);
    const flags = submitted.has(ratee) ? scored.flags : [...scored.flags, "noSubmission" as const];
    return {
      codeIndex: ratee,
      receivedPoints,
      raterCount,
      imputedCount,
      neutralShare: neutral,
      behaviorAverages,
      ...scored,
      flags,
    };
  });

  const factors = members.map((m) => m.factor);
  const spread = factors.length ? Math.max(...factors) - Math.min(...factors) : 0;
  const teamMean = factors.length ? factors.reduce((a, b) => a + b, 0) / factors.length : 1;
  return { teamLabel: team.teamLabel, members, spread, spreadFlagged: spread > SPREAD_FLAG, teamMean };
}
