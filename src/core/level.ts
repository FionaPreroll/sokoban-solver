// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

/**
 * Level model and (de)serialisation.
 *
 * A level is a rectangular grid stored as flat byte arrays (index = y * width + x).
 * Cells outside the grid count as walls, so levels do not have to be enclosed.
 */

export interface Level {
  readonly width: number;
  readonly height: number;
  /** 1 = wall, 0 = floor */
  readonly wall: Uint8Array;
  /** 1 = target (goal square) */
  readonly target: Uint8Array;
  /** 1 = box on this cell */
  readonly box: Uint8Array;
  /** Cell index of the player, or -1 if the level has no player. */
  readonly player: number;
}

export class LevelParseError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${String(line)}, column ${String(column)})`);
    this.name = "LevelParseError";
    this.line = line;
    this.column = column;
  }
}

export const MAX_LEVEL_SIZE = 64;

/**
 * Accepted characters. Both the standard XSB notation and the legacy notation of
 * the first version of this tool (x = wall, _ = floor, p = player, b = box, o = target)
 * are understood.
 */
const CHAR_MAP: Readonly<Record<string, { wall?: true; target?: true; box?: true; player?: true }>> = {
  "#": { wall: true },
  x: { wall: true },
  " ": {},
  "-": {},
  _: {},
  "@": { player: true },
  p: { player: true },
  "+": { player: true, target: true },
  $: { box: true },
  b: { box: true },
  "*": { box: true, target: true },
  ".": { target: true },
  o: { target: true },
};

export function createEmptyLevel(width: number, height: number): Level {
  assertSize(width, height);
  const size = width * height;
  return {
    width,
    height,
    wall: new Uint8Array(size),
    target: new Uint8Array(size),
    box: new Uint8Array(size),
    player: -1,
  };
}

function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid level size ${String(width)}x${String(height)}`);
  }
  if (width > MAX_LEVEL_SIZE || height > MAX_LEVEL_SIZE) {
    throw new RangeError(`Level larger than ${String(MAX_LEVEL_SIZE)}x${String(MAX_LEVEL_SIZE)}`);
  }
}

/** Parses a level from text (lines separated by newlines) or from an array of rows. */
export function parseLevel(input: string | readonly string[]): Level {
  let rows = typeof input === "string" ? input.replace(/\r/g, "").split("\n") : [...input];
  // Drop leading/trailing empty lines. Lines containing spaces are floor and stay.
  while (rows.length > 0 && rows[0] === "") rows = rows.slice(1);
  while (rows.length > 0 && rows[rows.length - 1] === "") rows = rows.slice(0, -1);
  if (rows.length === 0 || rows.every((r) => r.trim() === "")) {
    throw new LevelParseError("Level is empty", 1, 1);
  }
  const height = rows.length;
  const width = Math.max(1, ...rows.map((r) => r.length));
  if (width > MAX_LEVEL_SIZE || height > MAX_LEVEL_SIZE) {
    throw new LevelParseError(`Level larger than ${String(MAX_LEVEL_SIZE)}x${String(MAX_LEVEL_SIZE)}`, 1, 1);
  }
  const level = createEmptyLevel(width, height);
  const { wall, target, box } = level;
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      const spec = CHAR_MAP[ch];
      if (spec === undefined) {
        throw new LevelParseError(`Unknown character ${JSON.stringify(ch)}`, y + 1, x + 1);
      }
      const i = y * width + x;
      if (spec.wall) wall[i] = 1;
      if (spec.target) target[i] = 1;
      if (spec.box) box[i] = 1;
      if (spec.player) {
        if (player !== -1) {
          throw new LevelParseError("More than one player", y + 1, x + 1);
        }
        player = i;
      }
    }
  });
  return { ...level, player };
}

/** Serialises a level to XSB notation (one string per row, full width so floor rows survive). */
export function serializeLevel(level: Level): string[] {
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = "";
    for (let x = 0; x < level.width; x++) {
      row += cellChar(level, y * level.width + x);
    }
    rows.push(row);
  }
  return rows;
}

export function cellChar(level: Level, i: number): string {
  if (level.wall[i]) return "#";
  const t = level.target[i] === 1;
  if (level.player === i) return t ? "+" : "@";
  if (level.box[i]) return t ? "*" : "$";
  return t ? "." : " ";
}

export function cloneLevel(level: Level): Level {
  return {
    width: level.width,
    height: level.height,
    wall: level.wall.slice(),
    target: level.target.slice(),
    box: level.box.slice(),
    player: level.player,
  };
}

export function countOf(arr: Uint8Array): number {
  let n = 0;
  for (const v of arr) n += v;
  return n;
}

export type LevelIssue =
  | { kind: "no-player" }
  | { kind: "no-boxes" }
  | { kind: "too-many-boxes"; boxes: number; targets: number }
  | { kind: "box-target-mismatch"; boxes: number; targets: number };

/** Problems that make a level unsolvable or unusual. An empty list means "looks fine". */
export function validateLevel(level: Level): LevelIssue[] {
  const issues: LevelIssue[] = [];
  if (level.player < 0) issues.push({ kind: "no-player" });
  const boxes = countOf(level.box);
  const targets = countOf(level.target);
  if (boxes === 0) issues.push({ kind: "no-boxes" });
  else if (boxes > targets) issues.push({ kind: "too-many-boxes", boxes, targets });
  else if (boxes < targets) issues.push({ kind: "box-target-mismatch", boxes, targets });
  return issues;
}

export function describeIssue(issue: LevelIssue): string {
  switch (issue.kind) {
    case "no-player":
      return "No player yet. Place one with the Player tile.";
    case "no-boxes":
      return "No boxes, so the level is already solved.";
    case "too-many-boxes":
      return `${String(issue.boxes)} boxes but ${String(issue.targets)} targets: not solvable.`;
    case "box-target-mismatch":
      return `${String(issue.boxes)} boxes, ${String(issue.targets)} targets: extra targets stay empty.`;
  }
}

/** Returns a resized copy, keeping content anchored at the top-left corner. */
export function resizeLevel(level: Level, width: number, height: number): Level {
  const out = createEmptyLevel(width, height);
  let player = -1;
  for (let y = 0; y < Math.min(height, level.height); y++) {
    for (let x = 0; x < Math.min(width, level.width); x++) {
      const src = y * level.width + x;
      const dst = y * width + x;
      out.wall[dst] = level.wall[src] ?? 0;
      out.target[dst] = level.target[src] ?? 0;
      out.box[dst] = level.box[src] ?? 0;
      if (level.player === src) player = dst;
    }
  }
  return { ...out, player };
}

export type Tool = "wall" | "floor" | "player" | "box" | "target";

/**
 * Applies an editor tool to one cell and returns the new level.
 * Targets are a property of the floor, so boxes and the player can stand on them.
 */
export function paintCell(level: Level, i: number, tool: Tool): Level {
  if (i < 0 || i >= level.width * level.height) return level;
  const next = cloneLevel(level);
  const wall = next.wall;
  const target = next.target;
  const box = next.box;
  let player = next.player;
  switch (tool) {
    case "wall":
      wall[i] = 1;
      target[i] = 0;
      box[i] = 0;
      if (player === i) player = -1;
      break;
    case "floor":
      wall[i] = 0;
      target[i] = 0;
      box[i] = 0;
      if (player === i) player = -1;
      break;
    case "target":
      wall[i] = 0;
      target[i] = 1;
      break;
    case "box":
      wall[i] = 0;
      box[i] = 1;
      if (player === i) player = -1;
      break;
    case "player":
      wall[i] = 0;
      box[i] = 0;
      player = i;
      break;
  }
  return { ...next, player };
}

export function levelsEqual(a: Level, b: Level): boolean {
  return serializeLevel(a).join("\n") === serializeLevel(b).join("\n");
}
