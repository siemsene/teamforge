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
    let best = 0;
    let bestVal = -1;
    for (let t = 0; t < input.teams.length; t++) {
      const col = result.Columns[varName(i, t)];
      const val = col && "Primal" in col ? col.Primal : 0;
      if (val > bestVal) {
        bestVal = val;
        best = t;
      }
    }
    teams[input.teams[best].id].push(input.students[i].hash);
  }

  return {
    teams,
    objective: (result.ObjectiveValue ?? 0) + objectiveOffset,
    status: result.Status,
  };
}
