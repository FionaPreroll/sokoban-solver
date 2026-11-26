// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

/**
 * The CGA theme: 16×16 pixel-art tiles in the four colours of CGA palette 1, and a
 * 40-column status line drawn with the IBM CGA 8×8 font. The glyph bitmaps come from
 * pcface (Oldschool PC Font Pack by VileR, used under GPL-3.0).
 */

import cgaFontSource from "pcface/out/oldschool-cga-8x8/fontlist.js?raw";

/** 256 glyphs of code page 437, 8 bytes each (one per row, most significant bit left). */
const GLYPHS: readonly (readonly number[])[] = Array.from(
  cgaFontSource.matchAll(/\[((?:0x[0-9a-f]{2},\s*){7}0x[0-9a-f]{2})\]/gi),
  (m) => (m[1] ?? "").split(",").map((h) => parseInt(h, 16)),
);

/** Unicode characters used in the status line that are not plain ASCII. */
const CP437: Readonly<Record<string, number>> = { "▌": 0xdd, "▐": 0xde, "│": 0xb3 };

function glyph(ch: string): readonly number[] {
  const code = CP437[ch] ?? ch.charCodeAt(0);
  return GLYPHS[code] ?? GLYPHS[0x3f] ?? [];
}

export const STATUS_COLUMNS = 40;

export interface StatusLine {
  /** Built-in level number, or null for a custom level. */
  readonly level: number | null;
  readonly moves: number;
  readonly pushes: number;
  readonly seconds: number;
}

const pad = (n: number, width: number): string => String(Math.min(n, 10 ** width - 1)).padStart(width, "0");

export function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.min(9, Math.floor(s / 3600)))}:${pad(Math.floor(s / 60) % 60, 2)}:${pad(s % 60, 2)}`;
}

/** The status text, exactly 40 columns: " 08▐ moves:0308 pushes:0121 time:0:01:55". */
export function statusText(s: StatusLine): string {
  const level = s.level === null ? "--" : pad(s.level, 2);
  const text = ` ${level}▐ moves:${pad(s.moves, 4)} pushes:${pad(s.pushes, 4)} time:${formatClock(s.seconds)}`;
  return text.padEnd(STATUS_COLUMNS).slice(0, STATUS_COLUMNS);
}

export interface StatusColours {
  readonly background: string;
  readonly text: string;
  readonly accent: string;
}

/**
 * Draws the line across `width` device pixels and sets the canvas height. A CGA pixel
 * is a whole number of device pixels wide when there are at least two per pixel (so
 * every glyph column has the same width), and 1.2 times as tall, like on a 4:3 screen.
 */
export function drawStatusLine(
  canvas: HTMLCanvasElement,
  s: StatusLine,
  colours: StatusColours,
  width: number,
  dpr: number,
): void {
  const native = STATUS_COLUMNS * 8;
  const sx = width / native >= 2 ? Math.floor(width / native) : width / native;
  const sy = Number.isInteger(sx) ? Math.round(sx * 1.2) : sx * 1.2;
  const height = Math.max(8, Math.round(8 * sy));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const cssHeight = `${String(height / dpr)}px`;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, width, height);
  const left = Math.floor((width - native * sx) / 2);
  const ex = (i: number): number => left + Math.floor(i * sx);
  const ey = (i: number): number => Math.floor(i * sy);
  const text = statusText(s);
  for (let col = 0; col < text.length; col++) {
    const ch = text[col] ?? " ";
    ctx.fillStyle = ch === "▐" ? colours.accent : colours.text;
    const rows = glyph(ch);
    for (let y = 0; y < 8; y++) {
      const bits = rows[y] ?? 0;
      for (let x = 0; x < 8; x++) {
        if (!(bits & (0x80 >> x))) continue;
        const px = col * 8 + x;
        ctx.fillRect(ex(px), ey(y), ex(px + 1) - ex(px), ey(y + 1) - ey(y));
      }
    }
  }
}

/*
 * Tiles: 16×16, one character per pixel. "." is transparent (the floor shows through).
 * The pixel tests sample each cell at its centre (8, 8) and at (8, 2): walls are wall
 * colour at both, a box is box colour at (8, 2) and target colour at (8, 8) only when it
 * stands on a target, the player is player colour at (8, 8).
 */
export type SpriteName = "wall" | "box" | "boxOnTarget" | "target" | "player";

function brickWall(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 1) {
      rows.push("k".repeat(16));
      continue;
    }
    // Rows 2–4 and 10–12 have joints at 3 and 11, the others at 7 and 15 (running bond).
    const band = Math.floor(((y + 15) % 16) / 4);
    const joints = band % 2 === 0 ? [3, 11] : [7, 15];
    let row = "";
    for (let x = 0; x < 16; x++) row += joints.includes(x) ? "k" : "w";
    rows.push(row);
  }
  return rows;
}

const crate = (inner: (r: number, c: number) => string): string[] => {
  const rows = ["................", ".kkkkkkkkkkkkkk.", ".kbbbbbbbbbbbbk.", ".kbbbbbbbbbbbbk.", ".kbbkkkkkkkkbbk."];
  for (let r = 5; r <= 10; r++) {
    let mid = "";
    for (let c = 5; c <= 10; c++) mid += inner(r, c);
    rows.push(`.kbbk${mid}kbbk.`);
  }
  rows.push(".kbbkkkkkkkkbbk.", ".kbbbbbbbbbbbbk.", ".kbbbbbbbbbbbbk.", ".kkkkkkkkkkkkkk.", "................");
  return rows;
};

const SPRITES: Readonly<Record<SpriteName, readonly string[]>> = {
  wall: brickWall(),
  // Cyan panel with a white diagonal brace.
  box: crate((r, c) => (c - r === 0 || c - r === 1 ? "b" : "f")),
  // Panel filled with the target colour: placed.
  boxOnTarget: crate(() => "t"),
  target: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......tttt......",
    ".....tttttt.....",
    ".....tttttt.....",
    ".....tttttt.....",
    ".....tttttt.....",
    "......tttt......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  player: [
    "................",
    "......pppp......",
    ".....pppppp.....",
    ".....pbppbp.....",
    ".....pppppp.....",
    "......pppp......",
    "....pppppppp....",
    "...pppppppppp...",
    "...pp.pppp.pp...",
    "...pp.pppp.pp...",
    "......pppp......",
    "......pppp......",
    "......pp.pp.....",
    ".....pp...pp....",
    ".....pp...pp....",
    "................",
  ],
};
export interface SpriteColours {
  readonly wall: string;
  readonly floor: string;
  readonly box: string;
  readonly target: string;
  readonly player: string;
}

/**
 * Draws a sprite into the cell at (x, y) of size cs device pixels. Pixel edges are
 * whole device pixels so neighbouring tiles join without seams.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: SpriteName,
  x: number,
  y: number,
  cs: number,
  colours: SpriteColours,
): void {
  const fill: Readonly<Record<string, string>> = {
    k: "#000000",
    w: colours.wall,
    f: colours.floor,
    b: colours.box,
    t: colours.target,
    p: colours.player,
  };
  const edge = (i: number): number => Math.floor((i * cs) / 16);
  const rows = SPRITES[name];
  for (let r = 0; r < 16; r++) {
    const row = rows[r] ?? "";
    const y0 = y + edge(r);
    const h = y + edge(r + 1) - y0;
    let c = 0;
    while (c < 16) {
      const ch = row[c] ?? ".";
      let end = c + 1;
      while (end < 16 && row[end] === ch) end++;
      const colour = fill[ch];
      if (colour !== undefined) {
        ctx.fillStyle = colour;
        ctx.fillRect(x + edge(c), y0, edge(end) - edge(c), h);
      }
      c = end;
    }
  }
}
