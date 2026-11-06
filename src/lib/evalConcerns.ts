// The instructor's "trouble spots" report: everything in a computed round that
// is worth a conversation, pulled out of the per-team table and the detail CSV
// and ranked worst first. Pure module — no Firestore, no crypto, no React — so
// what gets flagged is directly unit-testable. The caller decrypts, computes
// factors, and hands the results in, exactly as for the CSV exports.
//
// Nothing here changes a factor or anything a student sees. It only decides
// what to put in front of the instructor.

import { displayName } from "./nicknames";
import { LOW_FACTOR_FLAG, MIN_RATERS_TO_PUBLISH, type TeamFactorResult } from "./teamFactor";
import type { Nicknames, PeerEvalAnswers, TeamDirectory } from "../types";

/** A behaviour averaging below this, on the 1-5 scale, is flagged. */
export const LOW_BEHAVIOR_AVERAGE = 3.5;
/**
 * A single real share below this is flagged even when the factor is fine.
 * Trimming drops one hostile rater on purpose, which keeps the grade fair but
 * also hides that one teammate was unhappy enough to say so.
 */
export const LOW_SINGLE_SHARE = 0.75;
/** Teams with at least this many non-submitters are flagged. */
export const MANY_NON_SUBMITTERS = 2;

export interface LowAllocation {
  rater: string;
  points: number;
  /** The even split on that rater's ballot. */
  evenSplit: number;
  /** Empty when the allocation sat inside the band and needed none. */
  justification: string;
}

export interface StudentConcern {
  teamLabel: string;
  codeIndex: number;
  name: string;
  factor: number;
  share: number;
  raterCount: number;
  reasons: string[];
  lowBehaviors: { label: string; average: number }[];
  /** Teammates who gave this student less than an even split, lowest first. */
  lowAllocations: LowAllocation[];
  /** Higher is worse; only used to order the report. */
  severity: number;
}

export interface TeamConcern {
  teamLabel: string;
  reasons: string[];
  /** Flagged students on this team, worst first. */
  students: StudentConcern[];
  severity: number;
}

export interface TroubleReport {
  /** Teams with anything flagged, worst first. */
  teams: TeamConcern[];
  /** Every confidential Part 3 comment, flagged or not — they are rare and
   * otherwise sit in one cell of the detail CSV. */
  comments: { teamLabel: string; rater: string; text: string }[];
  nonSubmitters: { teamLabel: string; names: string[] }[];
  /** Rated by too few teammates for their factor to be published; the
   * instructor is the only one who will ever see it. */
  factorHidden: { teamLabel: string; name: string; factor: number }[];
  studentCount: number;
}

export function buildTroubleReport(input: {
  results: { factors: TeamFactorResult }[];
  teams: TeamDirectory["teams"];
  byRater: Map<string, { submitted: PeerEvalAnswers }>;
  nicknames: Nicknames;
  includeBehaviors: boolean;
  behaviors: string[];
}): TroubleReport {
  const { results, teams, byRater, nicknames, includeBehaviors, behaviors } = input;
  const name = (idx: number) => {
    const shown = displayName(idx, nicknames);
    return shown === `#${idx}` ? shown : `${shown} (#${idx})`;
  };
  const directoryByLabel = new Map(teams.map((t) => [t.label, t]));

  const report: TroubleReport = { teams: [], comments: [], nonSubmitters: [], factorHidden: [], studentCount: 0 };

  for (const { factors } of results) {
    const team = directoryByLabel.get(factors.teamLabel);
    const ballots = (team?.members ?? [])
      .map((m) => ({ raterCodeIndex: m.codeIndex, answers: byRater.get(m.codeHash)?.submitted }))
      .filter((b): b is { raterCodeIndex: number; answers: PeerEvalAnswers } => b.answers != null);

    for (const b of ballots) {
      const text = b.answers.commentToInstructor?.trim();
      if (text) report.comments.push({ teamLabel: factors.teamLabel, rater: name(b.raterCodeIndex), text });
    }

    const students: StudentConcern[] = [];
    const missing: string[] = [];
    for (const m of factors.members) {
      report.studentCount += 1;
      if (m.flags.includes("noSubmission")) missing.push(name(m.codeIndex));
      if (m.raterCount < MIN_RATERS_TO_PUBLISH) {
        report.factorHidden.push({ teamLabel: factors.teamLabel, name: name(m.codeIndex), factor: m.factor });
      }

      const reasons: string[] = [];
      let severity = 0;
      if (m.flags.includes("lowFactor")) {
        reasons.push(`Factor ${m.factor.toFixed(2)}, below ${LOW_FACTOR_FLAG.toFixed(2)}`);
        severity += 10 + (LOW_FACTOR_FLAG - m.factor) * 20;
      }
      if (m.flags.includes("unanimousLow")) {
        reasons.push("Every teammate rated them the same, and low");
        severity += 3;
      }

      const lowBehaviors: { label: string; average: number }[] = [];
      if (includeBehaviors && m.behaviorAverages) {
        m.behaviorAverages.forEach((avg, i) => {
          if (avg < LOW_BEHAVIOR_AVERAGE) {
            lowBehaviors.push({ label: behaviors[i] ?? `Behaviour ${i + 1}`, average: avg });
          }
        });
        lowBehaviors.sort((a, b) => a.average - b.average);
      }
      if (lowBehaviors.length > 0) {
        reasons.push(
          `${lowBehaviors.length} behaviour${lowBehaviors.length === 1 ? "" : "s"} averaged below ${LOW_BEHAVIOR_AVERAGE.toFixed(1)}`,
        );
        severity += lowBehaviors.reduce((s, b) => s + 1 + (LOW_BEHAVIOR_AVERAGE - b.average), 0);
      }

      const lowestReal = Math.min(...m.receivedShares.filter((r) => !r.imputed).map((r) => r.share));
      if (!m.flags.includes("lowFactor") && lowestReal < LOW_SINGLE_SHARE) {
        reasons.push(`One teammate gave them ${lowestReal.toFixed(2)} of an even split`);
        severity += 1 + (LOW_SINGLE_SHARE - lowestReal) * 4;
      }

      if (reasons.length === 0) continue;

      const lowAllocations: LowAllocation[] = [];
      for (const b of ballots) {
        if (b.raterCodeIndex === m.codeIndex) continue;
        const points = b.answers.points?.[String(m.codeIndex)];
        const rated = Object.keys(b.answers.points ?? {}).length;
        if (typeof points !== "number" || rated === 0) continue;
        const evenSplit = 100 / rated;
        // Rounding puts somebody a point under on most teams; that is not a
        // judgment and would bury the real ones.
        if (points >= Math.floor(evenSplit)) continue;
        lowAllocations.push({
          rater: name(b.raterCodeIndex),
          points,
          evenSplit,
          justification: b.answers.justifications?.[String(m.codeIndex)]?.trim() ?? "",
        });
      }
      lowAllocations.sort((a, b) => a.points / a.evenSplit - b.points / b.evenSplit);

      students.push({
        teamLabel: factors.teamLabel,
        codeIndex: m.codeIndex,
        name: name(m.codeIndex),
        factor: m.factor,
        share: m.share,
        raterCount: m.raterCount,
        reasons,
        lowBehaviors,
        lowAllocations,
        severity,
      });
    }
    if (missing.length > 0) report.nonSubmitters.push({ teamLabel: factors.teamLabel, names: missing });

    const teamReasons: string[] = [];
    let teamSeverity = 0;
    if (factors.spreadFlagged) {
      teamReasons.push(`Factors spread ${factors.spread.toFixed(2)} from highest to lowest`);
      teamSeverity += 2;
    }
    if (missing.length >= MANY_NON_SUBMITTERS) {
      teamReasons.push(`${missing.length} of ${factors.members.length} did not submit`);
      teamSeverity += 1;
    }
    if (students.length === 0 && teamReasons.length === 0) continue;

    students.sort((a, b) => b.severity - a.severity);
    report.teams.push({
      teamLabel: factors.teamLabel,
      reasons: teamReasons,
      students,
      severity: teamSeverity + students.reduce((s, c) => s + c.severity, 0),
    });
  }

  report.teams.sort((a, b) => b.severity - a.severity);
  return report;
}
