// Builds the two peer-evaluation CSV exports. Pure module — no Firestore, no
// crypto, no React — so the row shapes are directly unit-testable. The caller
// decrypts, computes factors, and hands the results in.
//
//   Summary: one row per student, the figures behind their factor.
//   Detail:  one row per (rater, ratee), the raw allocations and justifications.

import { displayName } from "./nicknames";
import type { TeamFactorResult } from "./teamFactor";
import type { Nicknames, PeerEvalAnswers, TeamDirectory } from "../types";

export type CsvRow = (string | number)[];

export interface SummaryOptions {
  includeBehaviors: boolean;
  behaviors: string[];
}

export function buildSummaryRows(
  results: { factors: TeamFactorResult }[],
  nicknames: Nicknames,
  { includeBehaviors, behaviors }: SummaryOptions,
): CsvRow[] {
  const header: CsvRow = [
    "team",
    "student",
    "codeIndex",
    "raterCount",
    "imputedCount",
    "neutral",
    "share",
    "trimmedLow",
    "trimmedHigh",
    "factor",
    "teamMean",
    "flag",
    ...(includeBehaviors ? behaviors.map((_, i) => `behaviorAvg${i + 1}`) : []),
  ];

  const rows: CsvRow[] = [header];
  for (const { factors } of results) {
    for (const m of factors.members) {
      rows.push([
        factors.teamLabel,
        displayName(m.codeIndex, nicknames),
        m.codeIndex,
        m.raterCount,
        m.imputedCount,
        m.neutralShare.toFixed(2),
        m.share.toFixed(4),
        m.trimmedLow?.toFixed(4) ?? "",
        m.trimmedHigh?.toFixed(4) ?? "",
        m.factor.toFixed(4),
        factors.teamMean.toFixed(4),
        [...m.flags, factors.spreadFlagged ? "teamSpread" : ""].filter(Boolean).join("|"),
        ...(includeBehaviors
          ? (m.behaviorAverages ?? behaviors.map(() => "")).map((v) =>
              typeof v === "number" ? v.toFixed(2) : "",
            )
          : []),
      ]);
    }
  }
  return rows;
}

/**
 * One row per (rater, ratee). The rater's confidential Part 3 comment belongs
 * to the rater rather than to any one pairing, so it rides on the first row
 * that rater produces — which is the first teammate who is not themselves.
 *
 * It used to be pinned to the row whose *ratee* was the team's first member.
 * That row never exists when the rater *is* the first member, because a rater
 * never rates themselves, so exactly one student per team had their private
 * note to the instructor silently dropped from the export.
 */
export function buildDetailRows(
  teams: TeamDirectory["teams"],
  byRater: Map<string, PeerEvalAnswers>,
  nicknames: Nicknames,
): CsvRow[] {
  const rows: CsvRow[] = [["team", "rater", "ratee", "points", "justification", "comment"]];

  for (const team of teams) {
    for (const rater of team.members) {
      const ans = byRater.get(rater.codeHash);
      if (!ans) continue;
      let commentPending = ans.commentToInstructor?.trim() ?? "";

      for (const ratee of team.members) {
        if (ratee.codeIndex === rater.codeIndex) continue;
        rows.push([
          team.label,
          displayName(rater.codeIndex, nicknames),
          displayName(ratee.codeIndex, nicknames),
          ans.points[String(ratee.codeIndex)] ?? "",
          ans.justifications[String(ratee.codeIndex)] ?? "",
          commentPending,
        ]);
        commentPending = ""; // only on this rater's first row
      }
    }
  }
  return rows;
}
