// Loads HiGHS (WebAssembly) and solves the assignment MIP. Used both by the
// Web Worker (browser) and directly by unit tests (Node).

import highsLoader from "highs";
import { buildModel } from "./model";
import type { SolveResult, SolverInput } from "./types";

type Highs = Awaited<ReturnType<typeof highsLoader>>;

let highsPromise: Promise<Highs> | null = null;

function loadHighs(locateWasm?: (file: string) => string): Promise<Highs> {
  highsPromise ??= highsLoader(locateWasm ? { locateFile: locateWasm } : undefined);
  return highsPromise;
}

export async function solve(input: SolverInput, locateWasm?: (file: string) => string): Promise<SolveResult> {
  const highs = await loadHighs(locateWasm);
  const { lp, objectiveOffset, varName } = buildModel(input);

  const result = highs.solve(lp, {
    time_limit: input.timeLimitSeconds,
    mip_rel_gap: 0.01,
    output_flag: false,
  });

  if (result.Status === "Infeasible") {
    throw new Error("The model is infeasible. Check team sizes and capacities.");
  }
  if (result.Status !== "Optimal" && result.Status !== "Time limit reached") {
    throw new Error(`Solver finished with status "${result.Status}". Check team sizes and capacities.`);
  }

  const teams: Record<string, string[]> = Object.fromEntries(input.teams.map((t) => [t.id, []]));
  for (let i = 0; i < input.students.length; i++) {
    let best = -1;
    let bestVal = 0.5; // an assignment variable is binary; anything less is "not set"
    for (let t = 0; t < input.teams.length; t++) {
      const col = result.Columns[varName(i, t)];
      const val = col && "Primal" in col ? col.Primal : 0;
      if (val > bestVal) {
        bestVal = val;
        best = t;
      }
    }
    // "Time limit reached" can come back with no incumbent at all, in which case
    // every column is missing. Picking the argmax of nothing used to put the
    // whole class on the first team and report it as the best found so far.
    if (best < 0) {
      throw new Error(
        "The solver stopped before it found any complete allocation. Raise the time limit, relax the constraints, or use fewer teams.",
      );
    }
    teams[input.teams[best].id].push(input.students[i].hash);
  }

  // Team sizes are hard constraints in the model, so a solution that breaks them
  // is a solution we misread — better to say so than to hand back a roster the
  // instructor would have to spot the problem in themselves.
  for (const team of input.teams) {
    const size = teams[team.id].length;
    if (size < team.minSize || size > team.maxSize) {
      throw new Error(
        `The solver returned a team outside its size limits ("${team.name}": ${size}, allowed ${team.minSize}-${team.maxSize}). Please report this.`,
      );
    }
  }

  return {
    teams,
    objective: (result.ObjectiveValue ?? 0) + objectiveOffset,
    status: result.Status,
  };
}
