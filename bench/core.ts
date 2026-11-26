// SPDX-License-Identifier: GPL-3.0-only
/**
 * Before/after benchmark of the solver core in Node.
 *
 *   node bench/core.ts [--runs 5] [--legacy-timeout 120] [--no-legacy] [--json out.json]
 *
 * "legacy" is the unmodified original code (legacy/sokoban-solver.js) with its
 * `await delay(0)` every 100 states removed, i.e. the pure algorithm. In the browser
 * the original additionally paid a setTimeout per 100 states (see bench/browser.ts).
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { parseLevel, serializeLevel } from "../src/core/level.ts";
import { LEVEL_PRESETS } from "../src/core/levels.ts";
import { solve } from "../src/core/solver.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    "legacy-timeout": { type: "string", default: "120" },
    "no-legacy": { type: "boolean", default: false },
    json: { type: "string" },
  },
});
const runs = Number(values.runs);
const legacyTimeoutMs = Number(values["legacy-timeout"]) * 1000;

/** The original tool only knew x _ p b o and needed a rectangular grid. */
function toLegacyRows(rows: readonly string[]): string[] {
  const map: Record<string, string> = { "#": "x", " ": "_", "@": "p", $: "b", ".": "o" };
  return serializeLevel(parseLevel(rows)).map((r) => r.replace(/[# @$.]/g, (c) => map[c] ?? c));
}

interface LegacyRun {
  moves: number;
  expanded: number;
  ms: number;
}

function runLegacy(rows: string[]): Promise<LegacyRun | "timeout"> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./legacy-worker.ts", import.meta.url), {
      workerData: { rows, yields: false },
      resourceLimits: { maxOldGenerationSizeMb: 8192 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve("timeout");
    }, legacyTimeoutMs);
    worker.once("message", (m: LegacyRun) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};

const fmtMs = (ms: number): string =>
  ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(ms < 10 ? 2 : 0)} ms`;

interface Row {
  level: string;
  moves: number;
  newMs: number;
  newExpanded: number;
  legacy: LegacyRun | "timeout" | "skipped";
}

const results: Row[] = [];
for (const preset of LEVEL_PRESETS) {
  const level = parseLevel(preset.rows);
  solve(level); // warm-up
  const times: number[] = [];
  let last = solve(level);
  for (let i = 0; i < runs; i++) {
    last = solve(level);
    times.push(last.elapsedMs);
  }
  if (last.status !== "solved") throw new Error(`${preset.id}: ${last.status}`);
  const legacy = values["no-legacy"] ? "skipped" : await runLegacy(toLegacyRows(preset.rows));
  if (typeof legacy === "object" && legacy.moves !== last.moves.length) {
    throw new Error(`${preset.id}: legacy found ${String(legacy.moves)} moves, new ${String(last.moves.length)}`);
  }
  const row: Row = {
    level: preset.id,
    moves: last.moves.length,
    newMs: median(times),
    newExpanded: last.expanded,
    legacy,
  };
  results.push(row);
  console.error(`${preset.id}: done`);
}

const lines = [
  `| Level | Moves | Before (legacy) | After | Speed-up | States before → after |`,
  `|---|---:|---:|---:|---:|---:|`,
  ...results.map((r) => {
    const before =
      r.legacy === "timeout" ? `> ${fmtMs(legacyTimeoutMs)}` : r.legacy === "skipped" ? "–" : fmtMs(r.legacy.ms);
    const speedup =
      r.legacy === "timeout"
        ? `> ${Math.floor(legacyTimeoutMs / r.newMs).toLocaleString("en-US")}×`
        : r.legacy === "skipped"
          ? "–"
          : `${Math.round(r.legacy.ms / r.newMs).toLocaleString("en-US")}×`;
    const states = typeof r.legacy === "object" ? r.legacy.expanded.toLocaleString("en-US") : "?";
    return `| ${r.level} | ${String(r.moves)} | ${before} | ${fmtMs(r.newMs)} | ${speedup} | ${states} → ${r.newExpanded.toLocaleString("en-US")} |`;
  }),
];
console.log(`Node ${process.version}, ${String(runs)} runs (median) for the new solver, 1 run for legacy.\n`);
console.log(lines.join("\n"));
if (values.json) writeFileSync(values.json, JSON.stringify(results, null, 2));
