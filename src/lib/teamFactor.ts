// Team-factor computation for peer evaluations, mirroring the instructor's
// published spreadsheet ("Peer evaluation and team factor.xlsx") so students
// can verify the arithmetic:
//
//   - Each rater allocates 100 points across teammates (self excluded).
//   - Neutral is an equal split: 100 / (number of raters who rated you).
//   - On teams of five or more, the received rating farthest from your median
//     received rating is discarded; if two are equally far, the more favorable
//     one goes.
//   - Your adjusted mean is compared with neutral; the proportional gap is
//     halved and the result clamped to [floor, ceiling] (default 0.80–1.10).
//
// Pure module — no Firestore, no crypto — so it is directly unit-testable.

import type { PeerEvalAnswers } from "../types";

export interface FactorParams {
  factorFloor: number;
  factorCeiling: number;
}

export const DEFAULT_FACTOR_PARAMS: FactorParams = { factorFloor: 0.8, factorCeiling: 1.1 };

/** Factors below this trigger an instructor conversation before grades. */
export const LOW_FACTOR_FLAG = 0.9;
/** Teams whose factors spread further than this are flagged. */
export const SPREAD_FLAG = 0.25;

export interface TeamEvalInput {
  teamLabel: string;
  /** Every member's codeIndex — determines team size and who can be rated. */
  memberCodeIndexes: number[];
  /** Submitted evaluations from this team's members. */
  submissions: PeerEvalAnswers[];
}

export interface MemberFactorResult {
  codeIndex: number;
  /** Points received, one per submitting teammate (before any discard). */
  receivedPoints: number[];
  /** Number of teammates who rated this member. */
  raterCount: number;
  /** 100 / raterCount, or null with zero raters. */
  neutralShare: number | null;
  /** The received rating removed by the outlier rule, if any. */
  discardedPoint: number | null;
  /** Mean of received points after the discard, or null with zero raters. */
  adjustedMean: number | null;
  factor: number;
  /** Per-behavior mean of ratings received (index-aligned with config.behaviors). */
  behaviorAverages: number[] | null;
  flags: ("lowFactor" | "noRatings")[];
}

export interface TeamFactorResult {
  teamLabel: string;
  members: MemberFactorResult[];
  /** max(factor) - min(factor) across the team. */
  spread: number;
  spreadFlagged: boolean;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * The outlier rule: on teams of five or more members, drop the received rating
 * farthest from the median (tie -> drop the more favorable, i.e. higher, one).
 * With fewer than three received ratings the discard is skipped even on large
 * teams — dropping one of one or two ratings would let a single non-submitter
 * erase the entire signal.
 */
function applyDiscard(points: number[], teamSize: number): { kept: number[]; discarded: number | null } {
  if (teamSize < 5 || points.length < 3) return { kept: points, discarded: null };
  const sorted = [...points].sort((a, b) => a - b);
  const med = median(sorted);
  let discardIdx = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i] - med);
    const best = Math.abs(points[discardIdx] - med);
    if (d > best || (d === best && points[i] > points[discardIdx])) discardIdx = i;
  }
  return {
    kept: points.filter((_, i) => i !== discardIdx),
    discarded: points[discardIdx],
  };
}

export function computeMemberFactor(
  receivedPoints: number[],
  teamSize: number,
  params: FactorParams,
): Omit<MemberFactorResult, "codeIndex" | "behaviorAverages"> {
  const raterCount = receivedPoints.length;
  if (raterCount === 0) {
    return {
      receivedPoints,
      raterCount,
      neutralShare: null,
      discardedPoint: null,
      adjustedMean: null,
      factor: 1,
      flags: ["noRatings"],
    };
  }
  const neutralShare = 100 / raterCount;
  const { kept, discarded } = applyDiscard(receivedPoints, teamSize);
  const adjustedMean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const raw = 1 + (adjustedMean - neutralShare) / neutralShare / 2;
  const factor = Math.min(params.factorCeiling, Math.max(params.factorFloor, raw));
  const flags: MemberFactorResult["flags"] = factor < LOW_FACTOR_FLAG ? ["lowFactor"] : [];
  return { receivedPoints, raterCount, neutralShare, discardedPoint: discarded, adjustedMean, factor, flags };
}

export function computeTeamFactors(team: TeamEvalInput, params: FactorParams): TeamFactorResult {
  const teamSize = team.memberCodeIndexes.length;
  const members: MemberFactorResult[] = team.memberCodeIndexes.map((ratee) => {
    const received: number[] = [];
    const behaviorSums: number[] = [];
    const behaviorCounts: number[] = [];
    for (const sub of team.submissions) {
      if (sub.raterCodeIndex === ratee) continue;
      const pts = sub.points[String(ratee)];
      if (typeof pts === "number") received.push(pts);
      const ratings = sub.behaviorRatings?.[String(ratee)];
      if (ratings) {
        ratings.forEach((r, i) => {
          behaviorSums[i] = (behaviorSums[i] ?? 0) + r;
          behaviorCounts[i] = (behaviorCounts[i] ?? 0) + 1;
        });
      }
    }
    const behaviorAverages =
      behaviorCounts.length > 0 ? behaviorSums.map((s, i) => s / behaviorCounts[i]) : null;
    return {
      codeIndex: ratee,
      behaviorAverages,
      ...computeMemberFactor(received, teamSize, params),
    };
  });
  const factors = members.map((m) => m.factor);
  const spread = factors.length ? Math.max(...factors) - Math.min(...factors) : 0;
  return { teamLabel: team.teamLabel, members, spread, spreadFlagged: spread > SPREAD_FLAG };
}
