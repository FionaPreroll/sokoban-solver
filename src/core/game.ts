// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/** Game rules: applying moves to a level state and replaying solutions. */

import type { Level } from "./level.ts";

export type Direction = "U" | "R" | "D" | "L";

export const DIRECTIONS: readonly Direction[] = ["U", "R", "D", "L"];

export const DIRECTION_DELTA: Readonly<Record<Direction, { readonly dx: number; readonly dy: number }>> = {
  U: { dx: 0, dy: -1 },
  R: { dx: 1, dy: 0 },
  D: { dx: 0, dy: 1 },
  L: { dx: -1, dy: 0 },
};

export const DIRECTION_NAME: Readonly<Record<Direction, string>> = {
  U: "Up",
  R: "Right",
  D: "Down",
  L: "Left",
};

export interface GameState {
  readonly player: number;
  /** 1 = box on cell */
  readonly box: Uint8Array;
}

export interface StepResult {
  readonly state: GameState;
  readonly moved: boolean;
  readonly pushed: boolean;
}

export function initialState(level: Level): GameState {
  return { player: level.player, box: level.box.slice() };
}

function isWall(level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return true;
  return level.wall[y * level.width + x] === 1;
}

/** Applies one move. Bumping into a wall or an unpushable box leaves the state unchanged. */
export function step(level: Level, state: GameState, dir: Direction): StepResult {
  if (state.player < 0) return { state, moved: false, pushed: false };
  const { dx, dy } = DIRECTION_DELTA[dir];
  const px = state.player % level.width;
  const py = (state.player - px) / level.width;
  const nx = px + dx;
  const ny = py + dy;
  if (isWall(level, nx, ny)) return { state, moved: false, pushed: false };
  const ni = ny * level.width + nx;
  if (state.box[ni]) {
    const bx = nx + dx;
    const by = ny + dy;
    if (isWall(level, bx, by)) return { state, moved: false, pushed: false };
    const bi = by * level.width + bx;
    if (state.box[bi]) return { state, moved: false, pushed: false };
    const box = state.box.slice();
    box[ni] = 0;
    box[bi] = 1;
    return { state: { player: ni, box }, moved: true, pushed: true };
  }
  return { state: { player: ni, box: state.box }, moved: true, pushed: false };
}

export function isSolved(level: Level, state: GameState): boolean {
  for (let i = 0; i < state.box.length; i++) {
    if (state.box[i] && !level.target[i]) return false;
  }
  return true;
}

export interface Replay {
  /** states[0] is the initial state, states[k] the state after k moves. */
  readonly states: readonly GameState[];
  /** pushes[k] is true when move k pushed a box. */
  readonly pushes: readonly boolean[];
  /** Index of the first move that did not change the state, or -1. */
  readonly firstInvalid: number;
}

export function replay(level: Level, moves: readonly Direction[]): Replay {
  const states: GameState[] = [initialState(level)];
  const pushes: boolean[] = [];
  let firstInvalid = -1;
  let current = states[0] as GameState;
  moves.forEach((dir, k) => {
    const r = step(level, current, dir);
    if (!r.moved && firstInvalid === -1) firstInvalid = k;
    current = r.state;
    states.push(current);
    pushes.push(r.pushed);
  });
  return { states, pushes, firstInvalid };
}

/** LURD notation: lower case = walk, upper case = push. */
export function toLurd(moves: readonly Direction[], pushes: readonly boolean[]): string {
  return moves.map((m, k) => (pushes[k] ? m : m.toLowerCase())).join("");
}

export function fromLurd(text: string): Direction[] {
  const out: Direction[] = [];
  for (const ch of text.replace(/\s+/g, "")) {
    const d = ch.toUpperCase();
    if (d !== "U" && d !== "R" && d !== "D" && d !== "L") {
      throw new Error(`Invalid move character ${JSON.stringify(ch)}`);
    }
    out.push(d);
  }
  return out;
}
