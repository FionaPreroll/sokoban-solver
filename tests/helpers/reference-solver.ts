// SPDX-License-Identifier: GPL-3.0-only
/**
 * Deliberately naive move-optimal BFS used as a test oracle. It shares only the
 * rules (game.ts) with the real solver, not the search code.
 */
import { DIRECTIONS, initialState, isSolved, step, type Direction, type GameState } from "../../src/core/game.ts";
import type { Level } from "../../src/core/level.ts";

const keyOf = (s: GameState): string => `${String(s.player)}|${s.box.join("")}`;

export function referenceSolve(level: Level, maxStates = 200_000): { moves: Direction[] | null; exhausted: boolean } {
  if (level.player < 0) return { moves: null, exhausted: true };
  const start = initialState(level);
  if (isSolved(level, start)) return { moves: [], exhausted: true };
  const seen = new Set([keyOf(start)]);
  let frontier: { state: GameState; path: Direction[] }[] = [{ state: start, path: [] }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { state, path } of frontier) {
      for (const d of DIRECTIONS) {
        const r = step(level, state, d);
        if (!r.moved) continue;
        const k = keyOf(r.state);
        if (seen.has(k)) continue;
        seen.add(k);
        const p = [...path, d];
        if (isSolved(level, r.state)) return { moves: p, exhausted: true };
        next.push({ state: r.state, path: p });
      }
      if (seen.size > maxStates) return { moves: null, exhausted: false };
    }
    frontier = next;
  }
  return { moves: null, exhausted: true };
}
