// Web Worker entry: runs the MIP off the UI thread. The page terminates the
// worker to cancel a solve.

/// <reference lib="webworker" />

import wasmUrl from "highs/runtime?url";
import { solve } from "./solve";
import type { WorkerRequest, WorkerResponse } from "./types";

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type !== "solve") return;
  try {
    post({ type: "status", message: "Loading solver…" });
    const result = await solve(e.data.input, (file) => (file.endsWith(".wasm") ? wasmUrl : file));
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
