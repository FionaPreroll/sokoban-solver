// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

/**
 * Move-optimal Sokoban solver.
 *
 * A* over push states: a state is the sorted box squares plus the player's square
 * right after a push (which is where the pushed box stood). Walking is not searched
 * step by step; one player BFS per state gives the walking distance to every
 * pushing square, and a push costs that distance plus one move. The first solution
 * taken from the queue therefore has the minimum number of moves.
 *
 *  - the board is padded with walls so neighbours need no bounds checks,
 *  - a state is a short string of cell indices (player + sorted boxes),
 *  - the open list is a bucket queue on f = moves so far + lower bound,
 *  - the lower bound is the sum of each box's push distance to its nearest target
 *    (ignoring other boxes); one push changes it by at most one and costs at least
 *    one move, so it is consistent and optimality is kept,
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
  /** Current search bound: every solution still to be found has at least this many moves. */
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
  /** Pushes from each square to the nearest target ignoring other boxes; -1 if none or pruning is off. */
  readonly dist: Int32Array;
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

  // Push distance from every square to the nearest target, ignoring other boxes
  // (reverse BFS over box moves). Squares that cannot reach a target are dead.
  const dist = new Int32Array(N).fill(-1);
  const dead = new Uint8Array(N);
  if (pruning) {
    const queue: number[] = [];
    for (let c = 0; c < N; c++) {
      if (target[c]) {
        dist[c] = 0;
        queue.push(c);
      }
    }
    // The queue grows while iterating; for-of over an array visits appended items too.
    for (const c of queue) {
      const dc = dist[c] as number;
      for (const o of offsets) {
        const from = c - o; // box came from here...
        const stand = from - o; // ...pushed by a player standing here
        if (!wall[from] && !wall[stand] && dist[from] === -1) {
          dist[from] = dc + 1;
          queue.push(from);
        }
      }
    }
    for (let c = 0; c < N; c++) dead[c] = !wall[c] && dist[c] === -1 ? 1 : 0;
    for (const b of boxes) {
      if (dead[b]) return { ok: false, status: "unsolvable", reason: "a box is stuck" };
    }
  }

  const toLevelIndex = (p: number): number => (Math.floor(p / W) - 1) * w + (p % W) - 1;
  return { ok: true, prep: { W, wall, target, dead, dist, player, boxes, toLevelIndex } };
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
  const { W, wall, target, dead, dist, player, boxes } = outcome.prep;
  const nBoxes = boxes.length;
  const N = wall.length;
  boxes.sort((a, b) => a - b);
  let onTargets0 = 0;
  for (const b of boxes) onTargets0 += target[b] ?? 0;
  if (onTargets0 === nBoxes) return finish("solved", [], 0, 1, 0);

  const offsets = [-W, 1, W, -1];
  const occ = new Uint8Array(N);

  // Nodes: one per distinct (player, sorted boxes) key. g = moves so far, h = lower bound.
  const index = new Map<string, number>();
  const keys: string[] = [];
  let parent = new Int32Array(1 << 16);
  let pushDir = new Uint8Array(1 << 16);
  let gOf = new Int32Array(1 << 16);
  let hOf = new Int32Array(1 << 16);
  let closed = new Uint8Array(1 << 16);
  const grow = (): void => {
    const n = parent.length * 2;
    const p2 = new Int32Array(n);
    p2.set(parent);
    parent = p2;
    const d2 = new Uint8Array(n);
    d2.set(pushDir);
    pushDir = d2;
    const g2 = new Int32Array(n);
    g2.set(gOf);
    gOf = g2;
    const h2 = new Int32Array(n);
    h2.set(hOf);
    hOf = h2;
    const c2 = new Uint8Array(n);
    c2.set(closed);
    closed = c2;
  };

  // Bucket queue indexed by f = g + h. With a consistent h, f never decreases along
  // the pops, so a cursor that only moves forward is enough. Stale entries (a node
  // whose g improved later) are skipped when popped.
  const buckets: number[][] = [];
  let minF = 0;
  const enqueue = (id: number): void => {
    const f = (gOf[id] as number) + (hOf[id] as number);
    let b = buckets[f];
    if (b === undefined) {
      b = [];
      buckets[f] = b;
    }
    b.push(id);
    if (f < minF) minF = f;
  };

  /** Lower bound on the remaining moves: each box needs at least its push distance. */
  const lowerBound = (bs: readonly number[]): number => {
    let h = 0;
    for (const b of bs) h += Math.max(0, dist[b] as number);
    return h;
  };

  const addNode = (key: string, from: number, dir: number, g: number, h: number): number => {
    const id = keys.length;
    if (id >= parent.length) grow();
    index.set(key, id);
    keys.push(key);
    parent[id] = from;
    pushDir[id] = dir;
    gOf[id] = g;
    hOf[id] = h;
    enqueue(id);
    return id;
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

  // Player BFS over free squares; stamp marks squares seen in the current BFS.
  const stamp = new Uint32Array(N);
  const walk = new Int32Array(N);
  const cameFrom = new Uint8Array(N);
  const bfsQueue = new Int32Array(N);
  let epoch = 0;
  const reach = (from: number): void => {
    epoch++;
    stamp[from] = epoch;
    walk[from] = 0;
    let qh = 0;
    let qt = 0;
    bfsQueue[qt++] = from;
    while (qh < qt) {
      const c = bfsQueue[qh++] as number;
      const dc = (walk[c] as number) + 1;
      for (let dir = 0; dir < 4; dir++) {
        const n = c + (offsets[dir] as number);
        if (wall[n] || occ[n] || stamp[n] === epoch) continue;
        stamp[n] = epoch;
        walk[n] = dc;
        cameFrom[n] = dir;
        bfsQueue[qt++] = n;
      }
    }
  };

  const loadBoxes = (key: string, into: number[]): void => {
    for (let j = 0; j < nBoxes; j++) {
      const b = key.charCodeAt(j + 1);
      into[j] = b;
      occ[b] = 1;
    }
  };
  const clearBoxes = (bs: number[]): void => {
    for (let t = 0; t < nBoxes; t++) occ[bs[t] as number] = 0;
  };

  /** Rebuilds the move list: for each push, a shortest walk to the pushing square, then the push. */
  const pathTo = (id: number): Direction[] => {
    const chain: number[] = [];
    for (let n = id; n > 0; n = parent[n] ?? 0) chain.push(n);
    chain.reverse();
    const out: Direction[] = [];
    const bs = new Array<number>(nBoxes);
    let from = 0;
    for (const n of chain) {
      const key = keys[from] as string;
      loadBoxes(key, bs);
      const dir = pushDir[n] as number;
      // The pushed box ends where the player of the next state is not: the player
      // stands on the box's old square, so the pushing square is one step behind it.
      const boxFrom = (keys[n] as string).charCodeAt(0);
      const stand = boxFrom - (offsets[dir] as number);
      reach(key.charCodeAt(0));
      const steps: Direction[] = [];
      for (let c = stand; c !== key.charCodeAt(0); c -= offsets[cameFrom[c] as number] as number) {
        steps.push(DIRECTIONS[cameFrom[c] as number] as Direction);
      }
      for (let k = steps.length - 1; k >= 0; k--) out.push(steps[k] as Direction);
      out.push(DIRECTIONS[dir] as Direction);
      clearBoxes(bs);
      from = n;
    }
    return out;
  };

  const cur = new Array<number>(nBoxes);
  const next = new Array<number>(nBoxes);
  addNode(String.fromCharCode(player, ...boxes), -1, 0, 0, lowerBound(boxes));

  let expanded = 0;
  for (;;) {
    while (minF < buckets.length && (buckets[minF]?.length ?? 0) === 0) minF++;
    if (minF >= buckets.length) break;
    const id = (buckets[minF] as number[]).pop() as number;
    if (closed[id] || (gOf[id] as number) + (hOf[id] as number) !== minF) continue;
    closed[id] = 1;

    if (expanded % interval === 0 && expanded > 0) {
      onProgress?.({ expanded, generated: keys.length, depth: minF });
      if (shouldStop?.()) return finish("aborted", [], expanded, keys.length, minF);
    }
    expanded++;

    const key = keys[id] as string;
    const g = gOf[id] as number;
    loadBoxes(key, cur);
    let onT = 0;
    for (let j = 0; j < nBoxes; j++) onT += target[cur[j] as number] ?? 0;
    if (onT === nBoxes) {
      clearBoxes(cur);
      return finish("solved", pathTo(id), expanded, keys.length, g);
    }
    reach(key.charCodeAt(0));
    const h = hOf[id] as number;

    for (let j = 0; j < nBoxes; j++) {
      const b = cur[j] as number;
      for (let dir = 0; dir < 4; dir++) {
        const o = offsets[dir] as number;
        const stand = b - o;
        if (stamp[stand] !== epoch) continue;
        const nb = b + o;
        if (wall[nb] || occ[nb] || dead[nb]) continue;
        occ[b] = 0;
        occ[nb] = 1;
        const frozen = frozenSquare(nb);
        occ[nb] = 0;
        occ[b] = 1;
        if (frozen) continue;
        // New sorted box list: replace b by nb and restore order with one shift.
        for (let t = 0; t < nBoxes; t++) next[t] = cur[t] as number;
        let pos = j;
        next[pos] = nb;
        while (pos > 0 && (next[pos - 1] as number) > nb) {
          next[pos] = next[pos - 1] as number;
          next[--pos] = nb;
        }
        while (pos < nBoxes - 1 && (next[pos + 1] as number) < nb) {
          next[pos] = next[pos + 1] as number;
          next[++pos] = nb;
        }
        const k = String.fromCharCode(b, ...next);
        const ng = g + (walk[stand] as number) + 1;
        const known = index.get(k);
        if (known === undefined) {
          const nh = h - Math.max(0, dist[b] as number) + Math.max(0, dist[nb] as number);
          addNode(k, id, dir, ng, nh);
        } else if (!closed[known] && ng < (gOf[known] as number)) {
          gOf[known] = ng;
          parent[known] = id;
          pushDir[known] = dir;
          enqueue(known);
        }
      }
    }
    clearBoxes(cur);
    if (keys.length >= maxStates) {
      return finish("limit", [], expanded, keys.length, minF, `gave up after ${String(maxStates)} states`);
    }
  }
  return finish("unsolvable", [], expanded, keys.length, minF);
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
