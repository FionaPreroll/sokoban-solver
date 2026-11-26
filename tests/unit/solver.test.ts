// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import { isSolved, replay } from "../../src/core/game.ts";
import { parseLevel, type Level } from "../../src/core/level.ts";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";
import { deadSquares, solve } from "../../src/core/solver.ts";
import { referenceSolve } from "../helpers/reference-solver.ts";

function expectValidSolution(level: Level, moves: Parameters<typeof replay>[1]): void {
  const r = replay(level, moves);
  expect(r.firstInvalid).toBe(-1);
  const last = r.states[r.states.length - 1];
  expect(last && isSolved(level, last)).toBe(true);
}

describe("solve", () => {
  it("solves the original default level in the optimal 53 moves", () => {
    const level = parseLevel(LEVEL_PRESETS[0]?.rows ?? []);
    const result = solve(level);
    expect(result.status).toBe("solved");
    expect(result.moves).toHaveLength(53);
    expectValidSolution(level, result.moves);
  });

  it.each(LEVEL_PRESETS.map((p) => [p.id, p] as const))("solves preset %s", (_id, preset) => {
    const level = parseLevel(preset.rows);
    const result = solve(level);
    expect(result.status).toBe("solved");
    expectValidSolution(level, result.moves);
  });

  it("matches the reference solver on small presets", () => {
    for (const id of ["classic", "warmup", "staircase"]) {
      const level = parseLevel(LEVEL_PRESETS.find((p) => p.id === id)?.rows ?? []);
      expect(solve(level).moves.length).toBe(referenceSolve(level, 2_000_000).moves?.length);
    }
  });

  it("returns an empty solution for already solved levels", () => {
    expect(solve(parseLevel(["#@*#"]))).toMatchObject({ status: "solved", moves: [] });
    expect(solve(parseLevel(["#@ #"]))).toMatchObject({ status: "solved", moves: [] });
  });

  it("classifies invalid and unsolvable levels", () => {
    expect(solve(parseLevel(["$."])).status).toBe("invalid");
    expect(solve(parseLevel(["@$$."])).status).toBe("unsolvable");
    expect(solve(parseLevel(["#####", "#@  #", "##$##", "#. ##", "#####"])).status).toBe("unsolvable");
    // Box outside the player's reach, not on target.
    expect(solve(parseLevel(["@#$", ".# "])).status).toBe("unsolvable");
    // Box outside reach but already on target is fine.
    expect(solve(parseLevel(["@$.#*"]))).toMatchObject({ status: "solved", moves: ["R"] });
  });

  it("explores fully and reports unsolvable without pruning", () => {
    const level = parseLevel(["######", "#@$ .#", "#  ###", "######"]);
    expect(solve(level, { pruning: false }).status).toBe("solved");
    const stuck = parseLevel(["#####", "#@$ #", "#. ##", "#####"]);
    expect(solve(stuck, { pruning: false }).status).toBe("unsolvable");
  });

  it("supports progress, cancellation and state limits", () => {
    const level = parseLevel(LEVEL_PRESETS.find((p) => p.id === "mirror")?.rows ?? []);
    const seen: number[] = [];
    const aborted = solve(level, {
      progressInterval: 1000,
      onProgress: (p) => seen.push(p.expanded),
      shouldStop: () => seen.length >= 3,
    });
    expect(aborted.status).toBe("aborted");
    expect(seen).toEqual([1000, 2000, 3000]);
    const limited = solve(level, { maxStates: 5000 });
    expect(limited.status).toBe("limit");
    expect(limited.generated).toBeGreaterThanOrEqual(5000);
  });
});

describe("deadSquares", () => {
  it("marks corners and dead walls but not targets", () => {
    const level = parseLevel(["######", "#@   #", "#  . #", "######"]);
    const dead = deadSquares(level);
    const at = (x: number, y: number): number => dead[y * level.width + x] ?? -1;
    expect(at(1, 1)).toBe(1); // corner
    expect(at(4, 2)).toBe(1); // corner
    expect(at(2, 1)).toBe(1); // along the top wall, no target there
    expect(at(3, 2)).toBe(0); // target
    expect(at(2, 2)).toBe(0); // can be pushed right onto the target
    expect(at(0, 0)).toBe(0); // wall
  });
});
