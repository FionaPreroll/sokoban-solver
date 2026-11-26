// SPDX-License-Identifier: GPL-3.0-only
/** Worker thread wrapper so a slow legacy run can be killed after a timeout. */
import { parentPort, workerData } from "node:worker_threads";
import { createLegacySolver } from "./legacy-harness.ts";

const { rows, yields } = workerData as { rows: string[]; yields: boolean };
const solveLegacy = createLegacySolver({ yields });
const t0 = performance.now();
const result = await solveLegacy(rows);
parentPort?.postMessage({ moves: result.steps.length, expanded: result.visited, ms: performance.now() - t0 });
