// SPDX-License-Identifier: GPL-3.0-only
/**
 * Soak test: solve, cancel and replay for a fixed wall-clock budget and check that
 * results stay correct and the heap does not grow. SOAK_SECONDS sets the budget.
 */
import fc from "fast-check";
import { expect, it } from "vitest";
import { isSolved, replay } from "../../src/core/game.ts";
import { parseLevel, serializeLevel } from "../../src/core/level.ts";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";
import { solve } from "../../src/core/solver.ts";
import { arbPuzzle } from "../helpers/arbitraries.ts";

const seconds = Number(process.env["SOAK_SECONDS"] ?? 20);
const gc = (globalThis as { gc?: () => void }).gc;

const heapMb = (): number => {
  gc?.();
  return process.memoryUsage().heapUsed / 2 ** 20;
};

it(`stays correct and leak-free for ${String(seconds)} s`, () => {
  const presets = LEVEL_PRESETS.map((p) => parseLevel(p.rows));
  const expected = new Map<number, number>();
  const deadline = Date.now() + seconds * 1000;
  const samples: number[] = [];
  let iterations = 0;
  let solved = 0;
  let aborted = 0;
  let seed = Date.now() % 1_000_000;
  console.log(`soak seed ${String(seed)}`);

  while (Date.now() < deadline) {
    iterations++;
    if (iterations % 25 === 0) {
      // Every 25th round: a preset, sometimes cancelled half-way.
      const idx = (iterations / 25) % presets.length;
      const level = presets[idx];
      if (level === undefined) continue;
      const cancelAt = iterations % 3 === 0 ? 2 : Infinity;
      let ticks = 0;
      const r = solve(level, {
        progressInterval: 2000,
        onProgress: () => ticks++,
        shouldStop: () => ticks >= cancelAt,
      });
      if (r.status === "aborted") {
        aborted++;
        continue;
      }
      expect(r.status).toBe("solved");
      const known = expected.get(idx);
      if (known === undefined) expected.set(idx, r.moves.length);
      else expect(r.moves.length).toBe(known);
      solved++;
    } else {
      const [level] = fc.sample(arbPuzzle(), { numRuns: 1, seed: seed++ });
      if (level === undefined) continue;
      const r = solve(level, { maxStates: 200_000 });
      if (r.status === "solved") {
        const rp = replay(level, r.moves);
        const last = rp.states[rp.states.length - 1];
        expect(rp.firstInvalid, serializeLevel(level).join("\n")).toBe(-1);
        expect(last !== undefined && isSolved(level, last)).toBe(true);
        solved++;
      }
    }
    if (iterations % 200 === 0) samples.push(heapMb());
  }
  samples.push(heapMb());
  console.log(
    `soak: ${String(iterations)} rounds, ${String(solved)} solved, ${String(aborted)} cancelled, heap MB ${samples
      .map((s) => s.toFixed(1))
      .join(" ")}`,
  );
  expect(iterations).toBeGreaterThan(10);
  if (gc && samples.length >= 4) {
    const early = Math.min(...samples.slice(0, Math.ceil(samples.length / 4)));
    const late = samples[samples.length - 1] ?? 0;
    expect(late - early).toBeLessThan(64);
  }
});
