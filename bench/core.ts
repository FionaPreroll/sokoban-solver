// SPDX-License-Identifier: GPL-3.0-only
/**
 * Solver benchmark over the built-in levels.
 *
 *   node bench/core.ts [--runs 7] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseLevel } from "../src/core/level.ts";
import { LEVEL_PRESETS } from "../src/core/levels.ts";
import { solve } from "../src/core/solver.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "7" },
    json: { type: "string" },
  },
});
const runs = Math.max(1, Number(values.runs));

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};

const fmtMs = (ms: number): string => `${ms.toFixed(ms < 10 ? 2 : 0)} ms`;

const results = LEVEL_PRESETS.map((preset) => {
  const level = parseLevel(preset.rows);
  solve(level); // warm-up
  const times: number[] = [];
  let last = solve(level);
  for (let i = 0; i < runs; i++) {
    last = solve(level);
    times.push(last.elapsedMs);
  }
  if (last.status !== "solved") throw new Error(`${preset.id}: ${last.status}`);
  return { level: preset.id, moves: last.moves.length, states: last.expanded, ms: median(times) };
});

console.log(`Node ${process.version}, median of ${String(runs)} runs.\n`);
console.log(
  [
    "| Level | Moves | States searched | Time |",
    "|---|---:|---:|---:|",
    ...results.map((r) => `| ${r.level} | ${String(r.moves)} | ${r.states.toLocaleString("en-US")} | ${fmtMs(r.ms)} |`),
  ].join("\n"),
);
if (values.json) writeFileSync(values.json, JSON.stringify(results, null, 2));
