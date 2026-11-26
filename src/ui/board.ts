// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

/**
 * Canvas renderer. The tile shapes are the original ones: square walls, a round
 * player (r = 1/3 cell), an inset square box and a small round target (r = 1/4 cell).
 */

import { DIRECTION_DELTA, type Direction, type GameState } from "../core/game.ts";
import type { Level, Tool } from "../core/level.ts";
import { isSmallScreen } from "./dom.ts";
import type { Palette } from "./theme.ts";

export interface Layers {
  readonly path: boolean;
  readonly player: boolean;
  readonly dead: boolean;
}

export interface BoardScene {
  readonly level: Level;
  readonly state: GameState;
  readonly palette: Palette;
  readonly layers: Layers;
  readonly dead: Uint8Array | null;
  /** Full solution from the level's start and how many moves are already done. */
  readonly path: { readonly moves: readonly Direction[]; readonly index: number } | null;
  readonly editing: boolean;
}

const MIN_CELL = 12;
const MAX_CELL = 56;

function drawTarget(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Draws one tile (used for the board and the editor's tool swatches). */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cs: number,
  palette: Palette,
  tile: { wall: boolean; target: boolean; box: boolean; player: boolean },
): void {
  ctx.fillStyle = tile.wall ? palette.wall : palette.floor;
  ctx.fillRect(x, y, cs, cs);
  if (tile.wall) return;
  const cx = x + cs / 2;
  const cy = y + cs / 2;
  if (tile.box) {
    const inset = Math.max(2, Math.round(cs / 8));
    ctx.fillStyle = palette.box;
    ctx.fillRect(x + inset, y + inset, cs - 2 * inset, cs - 2 * inset);
    if (tile.target) {
      // Box on target: the target shows through as a ringed dot.
      drawTarget(ctx, cx, cy, cs / 5 + 1.5, palette.floor);
      drawTarget(ctx, cx, cy, cs / 5, palette.target);
    }
    return;
  }
  if (tile.target) drawTarget(ctx, cx, cy, cs / 4, palette.target);
  if (tile.player) {
    ctx.beginPath();
    ctx.arc(cx, cy, cs / 3, 0, 2 * Math.PI);
    ctx.fillStyle = palette.player;
    ctx.fill();
    if (tile.target) {
      ctx.lineWidth = Math.max(1.5, cs / 16);
      ctx.strokeStyle = palette.target;
      ctx.stroke();
    }
  }
}

export function toolTile(tool: Tool | null): { wall: boolean; target: boolean; box: boolean; player: boolean } {
  return { wall: tool === "wall", target: tool === "target", box: tool === "box", player: tool === "player" };
}

export class BoardView {
  private readonly canvas: HTMLCanvasElement;
  private readonly frame: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cell = 40;
  private last: BoardScene | null = null;

  constructor(canvas: HTMLCanvasElement, frame: HTMLElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.canvas = canvas;
    this.frame = frame;
    this.ctx = ctx;
    const ro = new ResizeObserver(() => {
      if (this.last) this.draw(this.last);
    });
    ro.observe(frame);
    window.addEventListener("resize", () => {
      if (this.last) this.draw(this.last);
    });
  }

  /** Cell index under a pointer position, or -1. Works at any CSS scale. */
  cellAt(clientX: number, clientY: number): number {
    const level = this.last?.level;
    if (!level) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * level.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * level.height);
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return -1;
    return y * level.width + x;
  }

  private fit(level: Level): void {
    const style = getComputedStyle(this.frame);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const availW = Math.max(100, this.frame.clientWidth - padX);
    const availH = window.innerHeight * (isSmallScreen() ? 0.36 : 0.72);
    const cs = Math.floor(Math.min(availW / level.width, availH / level.height));
    this.cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cs));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = level.width * this.cell;
    const h = level.height * this.cell;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.canvas.style.width = `${String(w)}px`;
    this.canvas.style.height = `${String(h)}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(scene: BoardScene): void {
    this.last = scene;
    const { level, state, palette, layers } = scene;
    this.fit(level);
    const cs = this.cell;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, level.width * cs, level.height * cs);
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const i = y * level.width + x;
        drawTile(ctx, x * cs, y * cs, cs, palette, {
          wall: level.wall[i] === 1,
          target: level.target[i] === 1,
          box: state.box[i] === 1,
          player: layers.player && state.player === i,
        });
      }
    }
    if (scene.editing) this.drawGrid(level, palette);
    if (layers.dead && scene.dead) this.drawDead(level, scene.dead, palette);
    if (layers.path && scene.path) this.drawPath(level, scene.path, palette);
  }

  private drawGrid(level: Level, palette: Palette): void {
    const cs = this.cell;
    const ctx = this.ctx;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < level.width; x++) {
      ctx.moveTo(x * cs + 0.5, 0);
      ctx.lineTo(x * cs + 0.5, level.height * cs);
    }
    for (let y = 1; y < level.height; y++) {
      ctx.moveTo(0, y * cs + 0.5);
      ctx.lineTo(level.width * cs, y * cs + 0.5);
    }
    ctx.stroke();
  }

  private drawDead(level: Level, dead: Uint8Array, palette: Palette): void {
    const cs = this.cell;
    const ctx = this.ctx;
    const d = cs * 0.14;
    ctx.strokeStyle = palette.dead;
    ctx.lineWidth = Math.max(1.5, cs / 20);
    ctx.beginPath();
    for (let i = 0; i < dead.length; i++) {
      if (!dead[i]) continue;
      const cx = (i % level.width) * cs + cs / 2;
      const cy = Math.floor(i / level.width) * cs + cs / 2;
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx - d, cy + d);
    }
    ctx.stroke();
  }

  /** The player's route through the whole solution, done part faded. */
  private drawPath(level: Level, path: { moves: readonly Direction[]; index: number }, palette: Palette): void {
    if (level.player < 0) return;
    const cs = this.cell;
    const ctx = this.ctx;
    let x = level.player % level.width;
    let y = Math.floor(level.player / level.width);
    ctx.strokeStyle = palette.path;
    ctx.lineWidth = Math.max(1.5, cs / 16);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const segment = (from: number, to: number, alpha: number): void => {
      if (from >= to) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(x * cs + cs / 2, y * cs + cs / 2);
      for (let k = from; k < to; k++) {
        const { dx, dy } = DIRECTION_DELTA[path.moves[k] as Direction];
        x += dx;
        y += dy;
        ctx.lineTo(x * cs + cs / 2, y * cs + cs / 2);
      }
      ctx.stroke();
    };
    segment(0, path.index, 0.3);
    segment(path.index, path.moves.length, 1);
    ctx.globalAlpha = 1;
  }
}
