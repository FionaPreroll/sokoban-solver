// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/**
 * Move-optimal Sokoban solver.
 *
 * Breadth-first search over (player, boxes) states, so the first solution found
 * has the minimum number of moves, exactly like the original solver. The speed-up
 * comes from the representation, not from giving up optimality:
 *
 *  - the board is padded with walls so neighbours need no bounds checks,
 *  - a state is a short string of cell indices (player + sorted boxes),
 *  - the queue is an index into the node list and paths are parent pointers,
 *  - boxes are never pushed onto dead squares (from which no target is reachable),
 *  - pushes that create a 2x2 block of walls/boxes with a box off target are cut.
 *
 * Both prunings only remove states that can never reach a solution, so the
 * minimum move count is unchanged.
 */

import { DIRECTIONS, type Direction } from "./game.ts";
import type { Level } from "./level.ts";

export type SolveStatus = "solved" | "unsolvable" | "aborted" | "limit" | "invalid";

export interface SolveProgress {
  /** States taken from the queue so far. */
  readonly expanded: number;
  /** Distinct states discovered so far. */
  readonly generated: number;
  /** Current BFS depth (= number of moves). */
  readonly depth: number;
}

export interface SolveResult extends SolveProgress {
  readonly status: SolveStatus;
  readonly moves: Direction[];
  readonly elapsedMs: number;
  readonly reason?: string;
}

export interface SolveOptions {
  /** Give up after this many distinct states (protects the tab's memory). */
  readonly maxStates?: number;
  /** Call onProgress / shouldStop every this many expanded states. */
  readonly progressInterval?: number;
  readonly onProgress?: (progress: SolveProgress) => void;
  readonly shouldStop?: () => boolean;
  /** Dead-square and freeze pruning. Only disable for testing. */
  readonly pruning?: boolean;
}

export const DEFAULT_MAX_STATES = 6_000_000;

const now = (): number => performance.now();

interface Prepared {
  readonly W: number;
  readonly wall: Uint8Array;
  readonly target: Uint8Array;
  readonly dead: Uint8Array;
  readonly player: number;
  readonly boxes: number[];
  readonly toLevelIndex: (padded: number) => number;
}

type PrepareOutcome = { ok: true; prep: Prepared } | { ok: false; status: SolveStatus; reason: string };

function prepare(level: Level, pruning: boolean): PrepareOutcome {
  const w = level.width;
  const h = level.height;
  if (level.player < 0) return { ok: false, status: "invalid", reason: "no player" };
  const W = w + 2;
  const N = W * (h + 2);
  const wall = new Uint8Array(N).fill(1);
  const target = new Uint8Array(N);
  const boxAt = new Uint8Array(N);
  const pad = (i: number): number => (Math.floor(i / w) + 1) * W + (i % w) + 1;
  for (let i = 0; i < w * h; i++) {
    const p = pad(i);
    wall[p] = level.wall[i] ?? 1;
    target[p] = level.wall[i] ? 0 : (level.target[i] ?? 0);
    boxAt[p] = level.wall[i] ? 0 : (level.box[i] ?? 0);
  }
  const player = pad(level.player);
  if (wall[player]) return { ok: false, status: "invalid", reason: "player inside a wall" };
  if (boxAt[player]) return { ok: false, status: "invalid", reason: "player on a box" };
  const offsets = [-W, 1, W, -1];

  // Everything the player could ever reach (boxes may move, so they do not block).
  const region = new Uint8Array(N);
  const stack = [player];
  region[player] = 1;
  while (stack.length > 0) {
    const c = stack.pop() as number;
    for (const o of offsets) {
      const n = c + o;
      if (!wall[n] && !region[n]) {
        region[n] = 1;
        stack.push(n);
      }
    }
  }
  const boxes: number[] = [];
  for (let c = 0; c < N; c++) {
    if (!boxAt[c]) continue;
    if (region[c]) boxes.push(c);
    else if (!target[c]) return { ok: false, status: "unsolvable", reason: "a box is out of reach" };
  }
  // Unreachable space (and boxes parked there on targets) behaves like wall.
  let targets = 0;
  for (let c = 0; c < N; c++) {
    if (!region[c]) {
      wall[c] = 1;
      target[c] = 0;
    } else if (target[c]) targets++;
  }
  if (boxes.length > targets) return { ok: false, status: "unsolvable", reason: "more boxes than targets" };

  // Live squares: a box there can be pushed to some target, ignoring other boxes.
  const dead = new Uint8Array(N);
  if (pruning) {
    const live = new Uint8Array(N);
    const queue: number[] = [];
    for (let c = 0; c < N; c++) {
      if (target[c]) {
        live[c] = 1;
        queue.push(c);
      }
    }
    // The queue grows while iterating; for-of over an array visits appended items too.
    for (const c of queue) {
      for (const o of offsets) {
        const from = c - o; // box came from here...
        const stand = from - o; // ...pushed by a player standing here
        if (!wall[from] && !wall[stand] && !live[from]) {
          live[from] = 1;
          queue.push(from);
        }
      }
    }
    for (let c = 0; c < N; c++) dead[c] = !wall[c] && !live[c] ? 1 : 0;
    for (const b of boxes) {
      if (dead[b]) return { ok: false, status: "unsolvable", reason: "a box is stuck" };
    }
  }

  const toLevelIndex = (p: number): number => (Math.floor(p / W) - 1) * w + (p % W) - 1;
  return { ok: true, prep: { W, wall, target, dead, player, boxes, toLevelIndex } };
}

export function solve(level: Level, options: SolveOptions = {}): SolveResult {
  const t0 = now();
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const interval = Math.max(1, options.progressInterval ?? 16384);
  const { onProgress, shouldStop } = options;
  const finish = (
    status: SolveStatus,
    moves: Direction[],
    expanded: number,
    generated: number,
    depth: number,
    reason?: string,
  ): SolveResult => ({
    status,
    moves,
    expanded,
    generated,
    depth,
    elapsedMs: now() - t0,
    ...(reason === undefined ? {} : { reason }),
  });

  const outcome = prepare(level, options.pruning ?? true);
  if (!outcome.ok) return finish(outcome.status, [], 0, 0, 0, outcome.reason);
  const { W, wall, target, dead, player, boxes } = outcome.prep;
  const nBoxes = boxes.length;
  boxes.sort((a, b) => a - b);
  let onTargets0 = 0;
  for (const b of boxes) onTargets0 += target[b] ?? 0;
  if (onTargets0 === nBoxes) return finish("solved", [], 0, 1, 0);

  const offsets = [-W, 1, W, -1];
  const occ = new Uint8Array(wall.length);
  const visited = new Set<string>();
  const keys: string[] = [];
  let parent = new Int32Array(1 << 16);
  let moveOf = new Uint8Array(1 << 16);

  const push = (key: string, from: number, dir: number): number => {
    const id = keys.length;
    if (id >= parent.length) {
      const np = new Int32Array(parent.length * 2);
      np.set(parent);
      parent = np;
      const nm = new Uint8Array(moveOf.length * 2);
      nm.set(moveOf);
      moveOf = nm;
    }
    visited.add(key);
    keys.push(key);
    parent[id] = from;
    moveOf[id] = dir;
    return id;
  };

  const pathTo = (id: number): Direction[] => {
    const out: Direction[] = [];
    for (let n = id; n > 0; n = parent[n] ?? 0) out.push(DIRECTIONS[moveOf[n] ?? 0] as Direction);
    return out.reverse();
  };

  const blocked = (c: number): boolean => wall[c] === 1 || occ[c] === 1;
  /** True if c is part of a 2x2 block of walls/boxes containing a box off target. */
  const frozenSquare = (c: number): boolean => {
    for (const [a, b, d] of [
      [1, W, W + 1],
      [-1, W, W - 1],
      [1, -W, -W + 1],
      [-1, -W, -W - 1],
    ] as const) {
      const ca = c + a;
      const cb = c + b;
      const cd = c + d;
      if (blocked(ca) && blocked(cb) && blocked(cd)) {
        if (
          (occ[c] && !target[c]) ||
          (occ[ca] && !target[ca]) ||
          (occ[cb] && !target[cb]) ||
          (occ[cd] && !target[cd])
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const cur = new Array<number>(nBoxes);
  const next = new Array<number>(nBoxes + 1);
  push(String.fromCharCode(player, ...boxes), -1, 0);

  let head = 0;
  let layerEnd = 1;
  let depth = 0;
  while (head < keys.length) {
    if (head === layerEnd) {
      depth++;
      layerEnd = keys.length;
    }
    if (head % interval === 0 && head > 0) {
      onProgress?.({ expanded: head, generated: keys.length, depth });
      if (shouldStop?.()) return finish("aborted", [], head, keys.length, depth);
    }
    const key = keys[head] as string;
    const p = key.charCodeAt(0);
    let onT = 0;
    for (let j = 0; j < nBoxes; j++) {
      const b = key.charCodeAt(j + 1);
      cur[j] = b;
      occ[b] = 1;
      onT += target[b] ?? 0;
    }
    const rest = key.slice(1);
    for (let dir = 0; dir < 4; dir++) {
      const o = offsets[dir] as number;
      const np = p + o;
      if (wall[np]) continue;
      if (!occ[np]) {
        const k = String.fromCharCode(np) + rest;
        if (!visited.has(k)) push(k, head, dir);
        continue;
      }
      const nb = np + o;
      if (wall[nb] || occ[nb] || dead[nb]) continue;
      occ[np] = 0;
      occ[nb] = 1;
      const frozen = frozenSquare(nb);
      occ[nb] = 0;
      occ[np] = 1;
      if (frozen) continue;
      // New sorted box list: replace np by nb and restore order with one shift.
      next[0] = np;
      let j = 0;
      while (cur[j] !== np) j++;
      for (let t = 0; t < nBoxes; t++) next[t + 1] = cur[t] as number;
      let pos = j + 1;
      next[pos] = nb;
      while (pos > 1 && (next[pos - 1] as number) > nb) {
        next[pos] = next[pos - 1] as number;
        next[--pos] = nb;
      }
      while (pos < nBoxes && (next[pos + 1] as number) < nb) {
        next[pos] = next[pos + 1] as number;
        next[++pos] = nb;
      }
      const k = String.fromCharCode(...next);
      if (visited.has(k)) continue;
      const id = push(k, head, dir);
      if (onT - (target[np] ?? 0) + (target[nb] ?? 0) === nBoxes) {
        for (let t = 0; t < nBoxes; t++) occ[cur[t] as number] = 0;
        return finish("solved", pathTo(id), head + 1, keys.length, depth + 1);
      }
    }
    for (let t = 0; t < nBoxes; t++) occ[cur[t] as number] = 0;
    head++;
    if (keys.length >= maxStates) {
      return finish("limit", [], head, keys.length, depth, `gave up after ${String(maxStates)} states`);
    }
  }
  return finish("unsolvable", [], head, keys.length, depth);
}

/** Cells (in level coordinates) on which a box can never reach a target. */
export function deadSquares(level: Level): Uint8Array {
  const out = new Uint8Array(level.width * level.height);
  const outcome = prepare(level, true);
  if (!outcome.ok) return out;
  const { dead, toLevelIndex } = outcome.prep;
  for (let p = 0; p < dead.length; p++) {
    if (dead[p]) out[toLevelIndex(p)] = 1;
  }
  return out;
}
