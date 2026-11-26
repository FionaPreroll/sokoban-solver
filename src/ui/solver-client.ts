// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

import type { Level } from "../core/level.ts";
import { DEFAULT_MAX_STATES, type SolveProgress, type SolveResult } from "../core/solver.ts";
import type { SolveRequest, SolveResponse } from "./solver-protocol.ts";

export interface SolveJob {
  readonly result: Promise<SolveResult>;
  cancel(): void;
}

/**
 * One worker per job: a new search can never run concurrently with an old one
 * (legacy bug), and cancelling is instant because the worker is simply terminated.
 */
export function startSolve(
  level: Level,
  onProgress: (p: SolveProgress) => void,
  maxStates = DEFAULT_MAX_STATES,
): SolveJob {
  const worker = new Worker(new URL("../solver.worker.ts", import.meta.url), { type: "module" });
  const t0 = performance.now();
  let last: SolveProgress = { expanded: 0, generated: 0, depth: 0 };
  let settle: ((r: SolveResult) => void) | null = null;
  const result = new Promise<SolveResult>((resolve, reject) => {
    settle = resolve;
    worker.onmessage = (event: MessageEvent<SolveResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        last = msg;
        onProgress(msg);
      } else if (msg.type === "result") {
        worker.terminate();
        resolve(msg.result);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Solver worker failed"));
    };
  });
  const request: SolveRequest = { type: "solve", level, maxStates };
  worker.postMessage(request);
  return {
    result,
    cancel() {
      worker.terminate();
      settle?.({ status: "aborted", moves: [], elapsedMs: performance.now() - t0, ...last });
    },
  };
}
