// Scores a fixed assignment with the same penalty accounting as the MIP, so
// the numbers shown during manual drag-and-drop edits match the solver's
// objective. Returns per-team detail rows for the violations panel.

import { WEIGHT_VALUES, type NumberQuestion } from "../types";
import { hasValue, numericAnswer, optionalNumericAnswer, rankedProjects, teammateHashes } from "./answers";
import type { SolverInput, SolverStudent } from "./types";

export interface ViolationDetail {
  teamId: string;
  /** "" = session-wide (e.g. unassigned students). */
  label: string;
  severity: "hard" | "must" | "important" | "nice";
  penalty: number;
}

export interface Evaluation {
  details: ViolationDetail[];
  totalPenalty: number;
  byTeam: Record<string, ViolationDetail[]>;
}

export function evaluateAssignment(input: SolverInput, assignment: Record<string, string[]>): Evaluation {
  const { students, teams, idealTeamSize, constraints, questions } = input;
  const details: ViolationDetail[] = [];
  const byHash = new Map(students.map((s) => [s.hash, s]));
  const members = new Map<string, SolverStudent[]>(
    teams.map((t) => [t.id, (assignment[t.id] ?? []).map((h) => byHash.get(h)).filter((s): s is SolverStudent => !!s)]),
  );

  const assigned = new Set(teams.flatMap((t) => assignment[t.id] ?? []));
  const unassigned = students.filter((s) => !assigned.has(s.hash));
  if (unassigned.length > 0) {
    details.push({
      teamId: "",
      label: `${unassigned.length} student(s) not assigned to any team`,
      severity: "hard",
      penalty: 0,
    });
  }

  for (const team of teams) {
    const m = members.get(team.id)!;
    if (m.length < team.minSize || m.length > team.maxSize) {
      details.push({
        teamId: team.id,
        label: `Team size ${m.length} outside the allowed ${team.minSize}–${team.maxSize}`,
        severity: "hard",
        penalty: 0,
      });
    }
    const dev = Math.abs(m.length - idealTeamSize);
    if (dev > 0) {
      details.push({
        teamId: team.id,
        label: `Team size ${m.length} differs from ideal ${idealTeamSize}`,
        severity: "nice",
        penalty: dev,
      });
    }
  }

  for (const c of constraints) {
    const W = WEIGHT_VALUES[c.weight];

    if (c.kind === "projectRequirements") {
      for (const team of teams) {
        const m = members.get(team.id)!;
        for (const req of team.requirements) {
          const qid = `auto-attr-${req.attributeKey}`;
          const count = m.filter((s) => hasValue(s.answers[qid], req.value)).length;
          const shortfall = Math.max(0, req.minCount - count);
          if (shortfall > 0) {
            details.push({
              teamId: team.id,
              label: `Needs ${req.minCount} × ${req.attributeLabel} = ${req.value}, has ${count}`,
              severity: c.weight,
              penalty: W * shortfall,
            });
          }
        }
      }
    }

    if (c.kind === "antiIsolation") {
      for (const team of teams) {
        const count = members.get(team.id)!.filter((s) => hasValue(s.answers[c.questionId], c.value)).length;
        if (count === 1) {
          details.push({
            teamId: team.id,
            label: `Exactly one student with "${c.value}" (must be none or 2+)`,
            severity: c.weight,
            penalty: W,
          });
        }
      }
    }

    if (c.kind === "balanceNumeric") {
      const q = questions.find((qq) => qq.id === c.questionId);
      const range = q && q.kind === "number" ? Math.max(1, (q as NumberQuestion).max - (q as NumberQuestion).min) : 1;
      // Mirrors buildModel: students with no answer to this question sit out of
      // the mean and out of each team's deviation, rather than counting as a 0
      // that is below the bottom of the scale.
      const answered = students
        .map((s) => optionalNumericAnswer(s.answers[c.questionId]))
        .filter((v): v is number => v != null);
      if (answered.length === 0) continue;
      const mean = answered.reduce((a, b) => a + b, 0) / answered.length;
      for (const team of teams) {
        const m = members.get(team.id)!;
        const centeredSum = m.reduce((a, s) => {
          const v = optionalNumericAnswer(s.answers[c.questionId]);
          return v == null ? a : a + v - mean;
        }, 0);
        const penalty = (W / range) * Math.abs(centeredSum);
        if (penalty > 0.5) {
          details.push({
            teamId: team.id,
            label: `Imbalanced on "${q?.prompt ?? c.questionId}" (${centeredSum > 0 ? "above" : "below"} average)`,
            severity: c.weight,
            penalty,
          });
        }
      }
    }

    if (c.kind === "minCapability") {
      const q = questions.find((qq) => qq.id === c.questionId);
      for (const team of teams) {
        const count = members.get(team.id)!.filter((s) => numericAnswer(s.answers[c.questionId]) >= c.threshold).length;
        const shortfall = Math.max(0, c.minCount - count);
        if (shortfall > 0) {
          details.push({
            teamId: team.id,
            label: `Needs ${c.minCount} student(s) with ≥${c.threshold} on "${q?.prompt ?? c.questionId}", has ${count}`,
            severity: c.weight,
            penalty: W * shortfall,
          });
        }
      }
    }

    if (c.kind === "projectPreference") {
      for (const team of teams) {
        for (const s of members.get(team.id)!) {
          const ranked = rankedProjects(s.answers, questions);
          if (ranked.length === 0) continue;
          const r = ranked.indexOf(team.id);
          const cost = r === -1 ? W : (W * r) / ranked.length;
          if (cost > 0) {
            details.push({
              teamId: team.id,
              label: `#${s.codeIndex} got ${r === -1 ? "an unranked project" : `choice ${r + 1}`}`,
              severity: c.weight,
              penalty: cost,
            });
          }
        }
      }
    }

    if (c.kind === "teammatePreference") {
      const teamOf = new Map<string, string>();
      for (const team of teams) for (const s of members.get(team.id)!) teamOf.set(s.hash, team.id);
      for (const s of students) {
        for (const wantedHash of teammateHashes(s.answers, questions)) {
          if (!byHash.has(wantedHash) || wantedHash === s.hash) continue;
          const a = teamOf.get(s.hash);
          const b = teamOf.get(wantedHash);
          if (a && a === b) continue;
          const other = byHash.get(wantedHash)!;
          details.push({
            teamId: a ?? "",
            label: `#${s.codeIndex} asked to work with #${other.codeIndex} (separated)`,
            severity: c.weight,
            penalty: W,
          });
        }
      }
    }
  }

  const byTeam: Record<string, ViolationDetail[]> = {};
  for (const d of details) (byTeam[d.teamId] ??= []).push(d);
  return { details, totalPenalty: details.reduce((a, d) => a + d.penalty, 0), byTeam };
}
