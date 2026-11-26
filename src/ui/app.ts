// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

import { initialState, replay, toLurd, type Direction, type GameState } from "../core/game.ts";
import {
  describeIssue,
  levelsEqual,
  LevelParseError,
  paintCell,
  parseLevel,
  resizeLevel,
  serializeLevel,
  validateLevel,
  type Level,
  type Tool,
} from "../core/level.ts";
import { DEFAULT_PRESET, LEVEL_PRESETS } from "../core/levels.ts";
import { deadSquares, type SolveResult } from "../core/solver.ts";
import { setupAboutDialog } from "./about.ts";
import { BoardView, drawTile, toolTile, type Layers } from "./board.ts";
import { byId, el, fmtInt, fmtMs, isSmallScreen, prefersReducedMotion } from "./dom.ts";
import { startSolve, type SolveJob } from "./solver-client.ts";
import { applyTheme, initialTheme, mountThemePicker, readPalette, saveTheme, type Palette } from "./theme.ts";

const LEVEL_STORAGE_KEY = "sokoban-solver:level";
const CUSTOM = "custom";
const MAX_UNDO = 100;

const TOOLS: readonly { id: Tool | null; label: string }[] = [
  { id: null, label: "Off" },
  { id: "wall", label: "Wall" },
  { id: "floor", label: "Floor" },
  { id: "player", label: "Player" },
  { id: "box", label: "Box" },
  { id: "target", label: "Target" },
];

interface Solution {
  readonly result: SolveResult;
  readonly moves: readonly Direction[];
  readonly states: readonly GameState[];
  readonly pushes: readonly boolean[];
  readonly pushCount: number;
}

function loadStoredLevel(): Level | null {
  try {
    const text = localStorage.getItem(LEVEL_STORAGE_KEY);
    return text ? parseLevel(text) : null;
  } catch {
    return null;
  }
}

function storeLevel(level: Level): void {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, serializeLevel(level).join("\n"));
  } catch {
    // ignore
  }
}

export class App {
  private level: Level;
  private undoStack: Level[] = [];
  private tool: Tool | null = null;
  private solution: Solution | null = null;
  private index = 0;
  private playTimer: number | null = null;
  private job: SolveJob | null = null;
  private dead: Uint8Array;
  private palette: Palette;
  private layers: Layers = { path: false, player: true, dead: false };
  private painting = false;
  private paintedDuringStroke = false;

  private readonly board: BoardView;
  private readonly ui = {
    panel: byId("board-panel", HTMLElement),
    result: byId("result", HTMLElement),
    preset: byId("preset", HTMLSelectElement),
    tools: byId("tools", HTMLElement),
    width: byId("width", HTMLInputElement),
    height: byId("height", HTMLInputElement),
    undo: byId("undo", HTMLButtonElement),
    text: byId("level-text", HTMLTextAreaElement),
    loadText: byId("load-text", HTMLButtonElement),
    copyText: byId("copy-text", HTMLButtonElement),
    issues: byId("issues", HTMLElement),
    solve: byId("solve", HTMLButtonElement),
    stop: byId("stop", HTMLButtonElement),
    progress: byId("progress", HTMLElement),
    reset: byId("reset", HTMLButtonElement),
    prev: byId("prev", HTMLButtonElement),
    play: byId("play", HTMLButtonElement),
    next: byId("next", HTMLButtonElement),
    scrub: byId("scrub", HTMLInputElement),
    speed: byId("speed", HTMLInputElement),
    moves: byId("moves", HTMLElement),
    copyMoves: byId("copy-moves", HTMLButtonElement),
    layerPath: byId("layer-path", HTMLInputElement),
    layerPlayer: byId("layer-player", HTMLInputElement),
    layerDead: byId("layer-dead", HTMLInputElement),
    stepLevel: byId("step-level", HTMLElement),
    stepSolve: byId("step-solve", HTMLElement),
    stepWatch: byId("step-watch", HTMLElement),
  };
  private toolCanvases: { tool: Tool | null; canvas: HTMLCanvasElement }[] = [];
  private moveSpans: HTMLSpanElement[] = [];

  constructor() {
    const theme = initialTheme();
    applyTheme(theme);
    this.palette = readPalette();
    mountThemePicker(byId("theme-picker", HTMLElement), theme, (id) => {
      applyTheme(id);
      saveTheme(id);
      this.palette = readPalette();
      this.drawToolIcons();
      this.render();
    });

    this.level = loadStoredLevel() ?? parseLevel(DEFAULT_PRESET.rows);
    this.dead = deadSquares(this.level);
    this.board = new BoardView(byId("board", HTMLCanvasElement), byId("board-frame", HTMLElement));

    this.buildPresetSelect();
    this.buildTools();
    this.bindLevelControls();
    this.bindBoard();
    this.bindSolve();
    this.bindPlayback();
    this.bindLayers();
    this.bindKeyboard();
    setupAboutDialog(
      byId("about", HTMLDialogElement),
      [byId("open-about", HTMLButtonElement), byId("footer-about", HTMLButtonElement)],
      byId("about-content", HTMLElement),
    );
    this.levelChanged({ store: false });
  }

  // ---------- level ----------

  private buildPresetSelect(): void {
    for (const p of LEVEL_PRESETS) this.ui.preset.append(el("option", { text: p.name, attrs: { value: p.id } }));
    this.ui.preset.append(el("option", { text: "Custom (your edits)", attrs: { value: CUSTOM, hidden: "" } }));
    this.ui.preset.addEventListener("change", () => {
      const preset = LEVEL_PRESETS.find((p) => p.id === this.ui.preset.value);
      if (preset) this.setLevel(parseLevel(preset.rows));
    });
  }

  private buildTools(): void {
    for (const t of TOOLS) {
      const input = el("input", { attrs: { type: "radio", name: "tool", value: t.id ?? "off" } });
      input.checked = t.id === this.tool;
      input.addEventListener("change", () => {
        if (input.checked) this.setTool(t.id);
      });
      const canvas = el("canvas", { attrs: { width: "80", height: "80", "aria-hidden": "true" } });
      this.toolCanvases.push({ tool: t.id, canvas });
      this.ui.tools.append(
        el("label", { className: t.id === null ? "tool tool-off" : "tool" }, [
          input,
          canvas,
          el("span", { text: t.label }),
        ]),
      );
    }
    this.drawToolIcons();
  }

  private drawToolIcons(): void {
    for (const { tool, canvas } of this.toolCanvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, 40, 40);
      if (tool === null) {
        ctx.fillStyle = this.palette.page;
        ctx.fillRect(0, 0, 40, 40);
        ctx.strokeStyle = this.palette.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(13, 13);
        ctx.lineTo(27, 27);
        ctx.moveTo(27, 13);
        ctx.lineTo(13, 27);
        ctx.stroke();
      } else {
        drawTile(ctx, 0, 0, 40, this.palette, toolTile(tool));
      }
    }
  }

  private setTool(tool: Tool | null): void {
    this.tool = tool;
    document.body.classList.toggle("editing", tool !== null);
    for (const input of this.ui.tools.querySelectorAll<HTMLInputElement>("input")) {
      input.checked = input.value === (tool ?? "off");
    }
    this.render();
  }

  private bindLevelControls(): void {
    const resize = (): void => {
      const w = Math.max(3, Math.min(30, Math.round(Number(this.ui.width.value))));
      const h = Math.max(3, Math.min(30, Math.round(Number(this.ui.height.value))));
      if (!Number.isFinite(w) || !Number.isFinite(h)) return;
      if (w !== this.level.width || h !== this.level.height) this.setLevel(resizeLevel(this.level, w, h), true);
    };
    this.ui.width.addEventListener("change", resize);
    this.ui.height.addEventListener("change", resize);
    this.ui.undo.addEventListener("click", () => {
      const prev = this.undoStack.pop();
      if (prev) {
        this.level = prev;
        this.levelChanged({ store: true });
      }
    });
    this.ui.loadText.addEventListener("click", () => {
      try {
        this.setLevel(parseLevel(this.ui.text.value), true);
      } catch (e) {
        this.ui.issues.textContent = e instanceof LevelParseError || e instanceof RangeError ? e.message : String(e);
      }
    });
    this.ui.copyText.addEventListener("click", () => {
      void navigator.clipboard.writeText(serializeLevel(this.level).join("\n")).then(() => {
        this.ui.copyText.textContent = "Copied";
        setTimeout(() => (this.ui.copyText.textContent = "Copy"), 1200);
      });
    });
  }

  /** Replace the level. `undoable` pushes the old one on the undo stack. */
  private setLevel(level: Level, undoable = false): void {
    if (levelsEqual(level, this.level)) return;
    if (undoable) {
      this.undoStack.push(this.level);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.level = level;
    this.levelChanged({ store: true });
  }

  private levelChanged({ store }: { store: boolean }): void {
    this.cancelSolve();
    this.clearSolution();
    this.dead = deadSquares(this.level);
    if (store) storeLevel(this.level);
    const preset = LEVEL_PRESETS.find((p) => levelsEqual(parseLevel(p.rows), this.level));
    const customOpt = this.ui.preset.querySelector<HTMLOptionElement>(`option[value="${CUSTOM}"]`);
    if (customOpt) customOpt.hidden = preset !== undefined;
    this.ui.preset.value = preset?.id ?? CUSTOM;
    this.ui.width.value = String(this.level.width);
    this.ui.height.value = String(this.level.height);
    this.ui.undo.disabled = this.undoStack.length === 0;
    if (document.activeElement !== this.ui.text) this.ui.text.value = serializeLevel(this.level).join("\n");
    const issues = validateLevel(this.level).filter((i) => i.kind !== "no-boxes");
    this.ui.issues.textContent = issues.map(describeIssue).join(" ");
    this.ui.progress.textContent = "";
    this.render();
  }

  // ---------- board editing ----------

  private bindBoard(): void {
    const canvas = byId("board", HTMLCanvasElement);
    const paintAt = (event: PointerEvent): void => {
      if (this.tool === null) return;
      const i = this.board.cellAt(event.clientX, event.clientY);
      if (i < 0) return;
      const next = paintCell(this.level, i, this.tool);
      if (levelsEqual(next, this.level)) return;
      if (!this.paintedDuringStroke) {
        // One undo step per stroke, not per cell.
        this.undoStack.push(this.level);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
        this.paintedDuringStroke = true;
      }
      this.level = next;
      this.levelChanged({ store: true });
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (this.tool === null) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this.painting = true;
      this.paintedDuringStroke = false;
      paintAt(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.painting && this.tool !== "player") paintAt(event);
    });
    const end = (): void => {
      this.painting = false;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  // ---------- solving ----------

  private bindSolve(): void {
    this.ui.solve.addEventListener("click", () => {
      void this.solve();
    });
    this.ui.stop.addEventListener("click", () => {
      this.cancelSolve();
    });
  }

  private cancelSolve(): void {
    this.job?.cancel();
  }

  private async solve(): Promise<void> {
    this.cancelSolve();
    this.clearSolution();
    const issues = validateLevel(this.level);
    if (issues.some((i) => i.kind === "no-player")) {
      this.ui.progress.textContent = "Place a player first.";
      return;
    }
    const level = this.level;
    this.ui.solve.disabled = true;
    this.ui.stop.hidden = false;
    this.ui.progress.textContent = "Searching…";
    this.setResult("Searching…", "");
    this.markStep();
    const job = startSolve(level, (p) => {
      const text = `${fmtInt(p.expanded)} states · ${String(p.depth)} moves deep`;
      this.ui.progress.textContent = `Searching… ${text}`;
      this.setResult("Searching…", text);
    });
    this.job = job;
    let result: SolveResult;
    try {
      result = await job.result;
    } catch (e) {
      result = {
        status: "invalid",
        moves: [],
        expanded: 0,
        generated: 0,
        depth: 0,
        elapsedMs: 0,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
    if (this.job !== job) return; // superseded
    this.job = null;
    this.ui.solve.disabled = false;
    this.ui.stop.hidden = true;
    if (level !== this.level) return;
    this.showResult(result);
  }

  private showResult(result: SolveResult): void {
    const stats = `${fmtInt(result.expanded)} states · ${fmtMs(result.elapsedMs)}`;
    switch (result.status) {
      case "solved": {
        const r = replay(this.level, result.moves);
        const pushCount = r.pushes.filter(Boolean).length;
        this.solution = { result, moves: result.moves, states: r.states, pushes: r.pushes, pushCount };
        this.index = 0;
        this.ui.progress.textContent =
          result.moves.length === 0
            ? "Already solved."
            : `Found the shortest solution: ${String(result.moves.length)} moves, ${String(pushCount)} pushes.`;
        this.buildMoves();
        this.markStep();
        this.render();
        this.drawAttention();
        return;
      }
      case "unsolvable":
        this.ui.progress.textContent = `No solution${result.reason ? `: ${result.reason}` : ""}.`;
        this.setResult("No solution", stats);
        break;
      case "limit":
        this.ui.progress.textContent = `Gave up after ${fmtInt(result.generated)} states. Try a smaller level.`;
        this.setResult("Gave up", stats);
        break;
      case "aborted":
        this.ui.progress.textContent = `Stopped after ${fmtInt(result.expanded)} states.`;
        this.setResult("Stopped", stats);
        break;
      case "invalid":
        this.ui.progress.textContent = `Cannot solve: ${result.reason ?? "invalid level"}.`;
        this.setResult("Cannot solve", "");
        break;
    }
    this.markStep();
  }

  /**
   * Pull the eye to the result: flash the board and its result line, and on small
   * screens scroll so the (sticky) board sits above the playback controls.
   */
  private drawAttention(): void {
    const panel = this.ui.panel;
    panel.classList.remove("flash");
    panel.getBoundingClientRect(); // force a reflow so the animation restarts
    panel.classList.add("flash");
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (isSmallScreen()) {
      const offset = panel.getBoundingClientRect().height + 8;
      const top = this.ui.stepWatch.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      const r = this.ui.stepWatch.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0) this.ui.stepWatch.scrollIntoView({ behavior, block: "nearest" });
    }
    this.ui.play.focus({ preventScroll: true });
  }

  private clearSolution(): void {
    this.pause();
    this.solution = null;
    this.index = 0;
    this.moveSpans = [];
    this.ui.moves.replaceChildren();
    this.ui.copyMoves.hidden = true;
    this.setResult("", "");
    this.markStep();
  }

  // ---------- playback ----------

  private bindPlayback(): void {
    this.ui.play.addEventListener("click", () => {
      this.togglePlay();
    });
    this.ui.next.addEventListener("click", () => {
      this.pause();
      this.goTo(this.index + 1);
    });
    this.ui.prev.addEventListener("click", () => {
      this.pause();
      this.goTo(this.index - 1);
    });
    this.ui.reset.addEventListener("click", () => {
      this.pause();
      this.goTo(0);
    });
    this.ui.scrub.addEventListener("input", () => {
      const target = Number(this.ui.scrub.value); // read before pause() re-syncs the slider
      this.pause();
      this.goTo(target);
    });
    this.ui.speed.addEventListener("change", () => {
      this.ui.speed.value = String(this.speed());
    });
    this.ui.copyMoves.addEventListener("click", () => {
      if (!this.solution) return;
      void navigator.clipboard.writeText(toLurd(this.solution.moves, this.solution.pushes)).then(() => {
        this.ui.copyMoves.textContent = "Copied";
        setTimeout(() => (this.ui.copyMoves.textContent = "Copy moves"), 1200);
      });
    });
  }

  private speed(): number {
    const v = Math.round(Number(this.ui.speed.value));
    return Number.isFinite(v) ? Math.max(1, Math.min(60, v)) : 4;
  }

  private togglePlay(): void {
    if (!this.solution || this.solution.moves.length === 0) return;
    if (this.playTimer !== null) {
      this.pause();
      return;
    }
    if (this.index >= this.solution.moves.length) this.goTo(0);
    const tick = (): void => {
      if (!this.solution || this.index >= this.solution.moves.length) {
        this.pause();
        return;
      }
      this.goTo(this.index + 1);
      this.playTimer = window.setTimeout(tick, 1000 / this.speed());
    };
    this.playTimer = window.setTimeout(tick, 1000 / this.speed());
    this.updateTransport();
  }

  private pause(): void {
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this.updateTransport();
  }

  private goTo(index: number): void {
    if (!this.solution) return;
    this.index = Math.max(0, Math.min(this.solution.moves.length, index));
    this.render();
  }

  private buildMoves(): void {
    if (!this.solution) return;
    const lurd = toLurd(this.solution.moves, this.solution.pushes);
    this.moveSpans = Array.from({ length: lurd.length }, (_, k) => el("span", { text: lurd.charAt(k) }));
    this.ui.moves.replaceChildren(...this.moveSpans);
    this.ui.copyMoves.hidden = lurd.length === 0;
  }

  private updateTransport(): void {
    const s = this.solution;
    const n = s?.moves.length ?? 0;
    const playing = this.playTimer !== null;
    this.ui.play.textContent = playing ? "Pause" : this.index > 0 && this.index < n ? "Resume" : "Play";
    this.ui.play.setAttribute("aria-label", this.ui.play.textContent);
    this.ui.play.disabled = n === 0;
    this.ui.next.disabled = n === 0 || this.index >= n;
    this.ui.prev.disabled = n === 0 || this.index === 0;
    this.ui.reset.disabled = n === 0 || this.index === 0;
    this.ui.scrub.disabled = n === 0;
    this.ui.scrub.max = String(n);
    this.ui.scrub.value = String(this.index);
  }

  // ---------- layers & keyboard ----------

  private bindLayers(): void {
    const update = (): void => {
      this.layers = {
        path: this.ui.layerPath.checked,
        player: this.ui.layerPlayer.checked,
        dead: this.ui.layerDead.checked,
      };
      this.render();
    };
    for (const box of [this.ui.layerPath, this.ui.layerPlayer, this.ui.layerDead])
      box.addEventListener("change", update);
    update();
  }

  private bindKeyboard(): void {
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }
      if (event.key === "ArrowRight") {
        this.pause();
        this.goTo(this.index + 1);
      } else if (event.key === "ArrowLeft") {
        this.pause();
        this.goTo(this.index - 1);
      } else if (event.key === " " && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        this.togglePlay();
      } else {
        return;
      }
    });
  }

  // ---------- rendering ----------

  private setResult(left: string, right: string): void {
    if (left === "" && right === "") {
      this.ui.result.replaceChildren();
      return;
    }
    this.ui.result.replaceChildren(el("strong", { text: left }), el("span", { text: right }));
  }

  private markStep(): void {
    const step = this.solution ? this.ui.stepWatch : this.job ? this.ui.stepSolve : null;
    for (const s of [this.ui.stepLevel, this.ui.stepSolve, this.ui.stepWatch]) {
      s.classList.toggle("is-current", s === step);
    }
  }

  private render(): void {
    const s = this.solution;
    const state = s?.states[this.index] ?? initialState(this.level);
    this.board.draw({
      level: this.level,
      state,
      palette: this.palette,
      layers: this.layers,
      dead: this.dead,
      path: s ? { moves: s.moves, index: this.index } : null,
      editing: this.tool !== null,
    });
    if (s) {
      const n = s.moves.length;
      const solved = this.index === n;
      const head =
        n === 0
          ? "Already solved"
          : solved
            ? `Solved in ${String(n)} moves`
            : this.index === 0
              ? `Solution: ${String(n)} moves`
              : `Move ${String(this.index)} / ${String(n)}`;
      const stats = `${String(s.pushCount)} pushes · ${fmtInt(s.result.expanded)} states · ${fmtMs(s.result.elapsedMs)}`;
      const tail = this.index === 0 || solved ? stats : s.pushes[this.index - 1] ? "push" : "walk";
      this.setResult(head, tail);
      this.moveSpans.forEach((span, k) => {
        span.className = k < this.index - 1 ? "done" : k === this.index - 1 ? "now" : "";
      });
    }
    this.updateTransport();
  }
}
