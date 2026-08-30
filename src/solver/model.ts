// Builds a mixed-integer program in CPLEX LP format for HiGHS.
//
// Variables
//   x_i_t        binary: student i assigned to team t
//   dp_t / dm_t  team size deviation above/below the ideal (soft, weight 1)
//   sreq_*       slack on project requirements
//   ziso_* siso_* indicator + slack for anti-isolation ("0 or >= 2")
//   bp_* bm_*     balance deviations
//   scap_*       slack on capability coverage
//   scat_*       slack on categorical coverage
//   galign_* salign_*  chosen answer per team + members outside it
//   y_*          pair variables rewarding satisfied teammate preferences
//
// Objective: minimize the weighted sum of all violations. Hard constraints:
// every student on exactly one team; team size within [min, max].

import { WEIGHT_VALUES, type NumberQuestion } from "../types";
import {
  categoryGroups,
  hasValue,
  numericAnswer,
  optionalNumericAnswer,
  rankedProjects,
  teammateHashes,
} from "./answers";
import type { SolverInput } from "./types";

export interface BuiltModel {
  lp: string;
  /** Constant added to the reported objective (teammate rewards are modeled as negative terms). */
  objectiveOffset: number;
  varName: (studentIndex: number, teamIndex: number) => string;
}

function terms(list: [number, string][]): string {
  return list
    .map(([coef, name], idx) => {
      const sign = coef < 0 ? "- " : idx === 0 ? "" : "+ ";
      const mag = Math.abs(coef);
      return `${sign}${mag === 1 ? "" : `${roundCoef(mag)} `}${name}`;
    })
    .join(" ");
}

function roundCoef(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(6);
}

export function buildModel(input: SolverInput): BuiltModel {
  const { students, teams, idealTeamSize, constraints, questions } = input;
  const nS = students.length;
  const nT = teams.length;
  if (nT === 0) throw new Error("No teams/projects defined.");
  const capacity = teams.reduce((acc, t) => acc + t.maxSize, 0);
  if (capacity < nS) {
    throw new Error(
      `Not enough team capacity: ${nS} students but max capacity ${capacity}. Increase max team size or add teams.`,
    );
  }
  const minRequired = teams.reduce((acc, t) => acc + t.minSize, 0);
  if (minRequired > nS) {
    throw new Error(
      `Too few students: minimum team sizes require ${minRequired} students but only ${nS} are enrolled.`,
    );
  }

  const x = (i: number, t: number) => `x_${i}_${t}`;
  const obj: [number, string][] = [];
  const cons: string[] = [];
  const bounds: string[] = [];
  const binaries: string[] = [];
  const generals: string[] = [];
  let objectiveOffset = 0;
  let cid = 0;
  const con = (expr: string) => cons.push(` c${cid++}: ${expr}`);

  for (let i = 0; i < nS; i++) for (let t = 0; t < nT; t++) binaries.push(x(i, t));

  // Each student on exactly one team.
  for (let i = 0; i < nS; i++) {
    con(`${terms(Array.from({ length: nT }, (_, t) => [1, x(i, t)] as [number, string]))} = 1`);
  }

  // Team size: hard min/max, soft deviation from the ideal.
  for (let t = 0; t < nT; t++) {
    const size = Array.from({ length: nS }, (_, i) => [1, x(i, t)] as [number, string]);
    con(`${terms(size)} >= ${teams[t].minSize}`);
    con(`${terms(size)} <= ${teams[t].maxSize}`);
    const dp = `dp_${t}`;
    const dm = `dm_${t}`;
    con(`${terms([...size, [-1, dp] as [number, string], [1, dm] as [number, string]])} = ${idealTeamSize}`);
    obj.push([1, dp], [1, dm]);
  }

  for (const c of constraints) {
    const W = WEIGHT_VALUES[c.weight];

    if (c.kind === "projectRequirements") {
      teams.forEach((team, t) => {
        team.requirements.forEach((req, r) => {
          const qid = `auto-attr-${req.attributeKey}`;
          const members = students
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => hasValue(s.answers[qid], req.value))
            .map(({ i }) => [1, x(i, t)] as [number, string]);
          const slack = `sreq_${t}_${r}`;
          bounds.push(` 0 <= ${slack} <= ${req.minCount}`);
          obj.push([W, slack]);
          if (members.length === 0) {
            // Nobody qualifies: the slack is forced to minCount (constant violation).
            con(`${slack} >= ${req.minCount}`);
          } else {
            con(`${terms([...members, [1, slack] as [number, string]])} >= ${req.minCount}`);
          }
        });
      });
    }

    if (c.kind === "antiIsolation") {
      const members = students
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => hasValue(s.answers[c.questionId], c.value));
      if (members.length === 0) continue;
      for (let t = 0; t < nT; t++) {
        const count = members.map(({ i }) => [1, x(i, t)] as [number, string]);
        const z = `ziso_${c.id}_${t}`;
        const slack = `siso_${c.id}_${t}`;
        binaries.push(z);
        bounds.push(` 0 <= ${slack} <= 2`);
        obj.push([W, slack]);
        // count <= maxSize * z  (any member present forces z = 1)
        con(`${terms([...count, [-teams[t].maxSize, z] as [number, string]])} <= 0`);
        // count + slack >= 2 z  (z = 1 demands two members unless slack absorbs it)
        con(`${terms([...count, [1, slack] as [number, string], [-2, z] as [number, string]])} >= 0`);
      }
    }

    if (c.kind === "balanceNumeric") {
      const q = questions.find((qq) => qq.id === c.questionId);
      const range = q && q.kind === "number" ? Math.max(1, (q as NumberQuestion).max - (q as NumberQuestion).min) : 1;
      // Students who never answered this question are left out of both the
      // mean and the per-team deviation. Counting them as 0 put them below the
      // bottom of the scale, so the optimizer worked to spread non-respondents
      // around as though they were the weakest students in the class — while
      // the allocation screen told the instructor they had no attributes.
      const values = students.map((s) => optionalNumericAnswer(s.answers[c.questionId]));
      const answered = values.filter((v): v is number => v != null);
      if (answered.length === 0) continue;
      const mean = answered.reduce((a, b) => a + b, 0) / answered.length;
      const unitWeight = W / range; // one "range unit" of imbalance costs W
      for (let t = 0; t < nT; t++) {
        const bp = `bp_${c.id}_${t}`;
        const bm = `bm_${c.id}_${t}`;
        const centered = students
          .map((_, i) => [values[i] == null ? 0 : values[i]! - mean, x(i, t)] as [number, string])
          .filter(([coef]) => Math.abs(coef) > 1e-9);
        obj.push([unitWeight, bp], [unitWeight, bm]);
        con(`${terms([...centered, [-1, bp] as [number, string], [1, bm] as [number, string]])} = 0`);
      }
    }

    if (c.kind === "minCapability") {
      const capable = students
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => numericAnswer(s.answers[c.questionId]) >= c.threshold);
      for (let t = 0; t < nT; t++) {
        const slack = `scap_${c.id}_${t}`;
        bounds.push(` 0 <= ${slack} <= ${c.minCount}`);
        obj.push([W, slack]);
        if (capable.length === 0) {
          con(`${slack} >= ${c.minCount}`);
        } else {
          const members = capable.map(({ i }) => [1, x(i, t)] as [number, string]);
          con(`${terms([...members, [1, slack] as [number, string]])} >= ${c.minCount}`);
        }
      }
    }

    if (c.kind === "minCategory") {
      const holders = students
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => hasValue(s.answers[c.questionId], c.value));
      for (let t = 0; t < nT; t++) {
        const slack = `scat_${c.id}_${t}`;
        bounds.push(` 0 <= ${slack} <= ${c.minCount}`);
        obj.push([W, slack]);
        if (holders.length === 0) {
          // Nobody in the class gave this answer: a constant violation, the same
          // way an unfillable project requirement is handled above.
          con(`${slack} >= ${c.minCount}`);
        } else {
          const members = holders.map(({ i }) => [1, x(i, t)] as [number, string]);
          con(`${terms([...members, [1, slack] as [number, string]])} >= ${c.minCount}`);
        }
      }
    }

    if (c.kind === "alignCategory") {
      // Each team picks one answer to settle on (galign) and pays for every
      // member holding a different one (salign). The solver does the picking,
      // so no answer is privileged: a team of remote workers is as cheap as a
      // team of in-person ones.
      const groups = categoryGroups(students.map((s) => s.answers[c.questionId]));
      if (groups.size < 2) continue; // one answer (or none) in play: nothing to align
      const values = [...groups.keys()];
      for (let t = 0; t < nT; t++) {
        const M = teams[t].maxSize;
        const odd = `salign_${c.id}_${t}`;
        bounds.push(` 0 <= ${odd} <= ${M}`);
        obj.push([W, odd]);
        const picks: [number, string][] = [];
        values.forEach((v, k) => {
          const g = `galign_${c.id}_${t}_${k}`;
          binaries.push(g);
          picks.push([1, g]);
          const others = values
            .filter((w) => w !== v)
            .flatMap((w) => groups.get(w)!.map((i) => [-1, x(i, t)] as [number, string]));
          // odd >= (members not holding v) - M (1 - g), i.e. the bound only
          // binds for the answer this team actually settled on.
          con(`${terms([[1, odd], ...others, [-M, g] as [number, string]])} >= ${-M}`);
        });
        con(`${terms(picks)} = 1`);
      }
    }

    if (c.kind === "projectPreference") {
      const teamIndexById = new Map(teams.map((t, idx) => [t.id, idx]));
      for (let i = 0; i < nS; i++) {
        const ranked = rankedProjects(students[i].answers, questions);
        if (ranked.length === 0) continue; // no stated preference -> no penalty either way
        for (let t = 0; t < nT; t++) {
          const r = ranked.indexOf(teams[t].id);
          // Rank 0 costs nothing; later ranks cost proportionally; unranked costs W.
          const cost = r === -1 ? W : (W * r) / ranked.length;
          if (cost > 0) obj.push([cost, x(i, t)]);
        }
        void teamIndexById;
      }
    }

    if (c.kind === "teammatePreference") {
      const hashToIndex = new Map(students.map((s, i) => [s.hash, i]));
      students.forEach((s, i) => {
        const wanted = teammateHashes(s.answers, questions);
        for (const targetHash of wanted) {
          const j = hashToIndex.get(targetHash);
          if (j === undefined || j === i) continue;
          // Reward both students sharing any team; one unsatisfied wish costs W.
          objectiveOffset += W;
          for (let t = 0; t < nT; t++) {
            const y = `y_${i}_${j}_${t}`;
            bounds.push(` 0 <= ${y} <= 1`);
            obj.push([-W, y]);
            con(`${terms([[1, y], [-1, x(i, t)]])} <= 0`);
            con(`${terms([[1, y], [-1, x(j, t)]])} <= 0`);
          }
          // At most one shared team is countable.
          con(`${terms(Array.from({ length: nT }, (_, t) => [1, `y_${i}_${j}_${t}`] as [number, string]))} <= 1`);
        }
      });
    }
  }

  // Aggregate repeated objective terms per variable (LP format dislikes duplicates).
  const objAgg = new Map<string, number>();
  for (const [coef, name] of obj) objAgg.set(name, (objAgg.get(name) ?? 0) + coef);
  const objTerms: [number, string][] = [...objAgg.entries()]
    .filter(([, coef]) => Math.abs(coef) > 1e-12)
    .map(([name, coef]) => [coef, name]);

  const lp = [
    "Minimize",
    ` obj: ${terms(objTerms)}`,
    "Subject To",
    ...cons,
    ...(bounds.length ? ["Bounds", ...bounds] : []),
    "Binary",
    ` ${binaries.join(" ")}`,
    ...(generals.length ? ["General", ` ${generals.join(" ")}`] : []),
    "End",
  ].join("\n");

  return { lp, objectiveOffset, varName: x };
}
