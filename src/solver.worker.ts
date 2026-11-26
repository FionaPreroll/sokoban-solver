// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/** Runs the solver off the main thread. Cancelling = terminating this worker. */

import { solve } from "./core/solver.ts";
import type { SolveRequest, SolveResponse } from "./ui/solver-protocol.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage(message: SolveResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
const PROGRESS_EVERY_MS = 80;

scope.onmessage = (event) => {
  const { level, maxStates } = event.data;
  let lastPost = 0;
  try {
    const result = solve(level, {
      maxStates,
      progressInterval: 4096,
      onProgress: (p) => {
        const t = performance.now();
        if (t - lastPost >= PROGRESS_EVERY_MS) {
          lastPost = t;
          scope.postMessage({ type: "progress", ...p });
        }
      },
    });
    scope.postMessage({ type: "result", result });
  } catch (e) {
    scope.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
