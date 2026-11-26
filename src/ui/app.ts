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
import type { StatusLine } from "./cga.ts";
import { byId, el, fmtInt, fmtMs, isSmallScreen, prefersReducedMotion } from "./dom.ts";
import { startSolve, type SolveJob } from "./solver-client.ts";
import { applyTheme, initialTheme, mountThemePicker, readPalette, saveTheme, type Palette } from "./theme.ts";

const LEVEL_STORAGE_KEY = "sokoban-solver:level";
const CUSTOM = "custom";
const MAX_UNDO = 100;
const SPEEDS = [1, 2, 4, 8, 16, 32] as const;
const DEFAULT_SPEED = 4;
const SOLVE_HINT = "Finds a solution with the fewest possible moves.";
const MOVES_PLACEHOLDER = "The moves appear here after solving. Lower case walks, upper case pushes.";

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
    speed: byId("speed", HTMLElement),
    end: byId("end", HTMLButtonElement),
    resultLabel: byId("result-label", HTMLElement),
    resultStats: byId("result-stats", HTMLElement),
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
    this.board = new BoardView(
      byId("board", HTMLCanvasElement),
      byId("board-frame", HTMLElement),
      byId("status-line", HTMLCanvasElement),
    );

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
      const canvas = el("canvas", { attrs: { width: "88", height: "88", "aria-hidden": "true" } });
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
      const size = canvas.width;
      ctx.clearRect(0, 0, size, size);
      if (tool === null) {
        // "Off": a pointer arrow, i.e. look, don't paint.
        ctx.fillStyle = this.palette.page;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = this.palette.ink;
        ctx.beginPath();
        const u = size / 44;
        ctx.moveTo(15 * u, 10 * u);
        ctx.lineTo(15 * u, 33 * u);
        ctx.lineTo(20.5 * u, 27.5 * u);
        ctx.lineTo(24.5 * u, 35 * u);
        ctx.lineTo(28 * u, 33.3 * u);
        ctx.lineTo(24 * u, 26 * u);
        ctx.lineTo(31 * u, 26 * u);
        ctx.closePath();
        ctx.fill();
      } else {
        drawTile(ctx, 0, 0, size, this.palette, toolTile(tool));
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
    const issueText = issues.map(describeIssue).join(" ");
    this.ui.issues.textContent = issueText;
    this.ui.issues.title = issueText;
    this.ui.progress.textContent = SOLVE_HINT;
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
    this.ui.stop.disabled = false;
    this.ui.panel.classList.add("is-solving");
    this.ui.progress.textContent = "Searching…";
    this.setResult("Searching…", "");
    this.markStep();
    const job = startSolve(level, (p) => {
      const text = `${fmtInt(p.expanded)} states · at least ${String(p.depth)} moves`;
      this.ui.progress.textContent = `Searching… ${text}`;
      this.setResult("Searching…", text);
    });
    this.job = job;
    this.markStep();
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
    this.ui.stop.disabled = true;
    this.ui.panel.classList.remove("is-solving");
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
    this.ui.moves.replaceChildren(el("span", { className: "placeholder", text: MOVES_PLACEHOLDER }));
    this.ui.copyMoves.disabled = true;
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
    this.ui.end.addEventListener("click", () => {
      this.pause();
      this.goTo(Number.MAX_SAFE_INTEGER);
    });
    for (const v of SPEEDS) {
      const input = el("input", {
        attrs: { type: "radio", name: "speed", value: String(v), "aria-label": `${String(v)} moves per second` },
      });
      input.checked = v === DEFAULT_SPEED;
      input.addEventListener("change", () => {
        this.render(); // the status line's clock depends on the speed
      });
      this.ui.speed.append(el("label", {}, [input, el("span", { text: String(v) })]));
    }
    this.ui.copyMoves.addEventListener("click", () => {
      if (!this.solution) return;
      void navigator.clipboard.writeText(toLurd(this.solution.moves, this.solution.pushes)).then(() => {
        this.ui.copyMoves.textContent = "Copied";
        setTimeout(() => (this.ui.copyMoves.textContent = "Copy"), 1200);
      });
    });
  }

  private speed(): number {
    const checked = this.ui.speed.querySelector<HTMLInputElement>("input:checked");
    const v = Number(checked?.value ?? DEFAULT_SPEED);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SPEED;
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
    this.ui.copyMoves.disabled = lurd.length === 0;
    if (lurd.length === 0) {
      this.ui.moves.replaceChildren(el("span", { className: "placeholder", text: "Nothing to do: already solved." }));
    }
  }

  private updateTransport(): void {
    const s = this.solution;
    const n = s?.moves.length ?? 0;
    const playing = this.playTimer !== null;
    // Only the icon changes (same button size), so nothing next to it moves.
    const label = playing ? "Pause" : this.index > 0 && this.index < n ? "Resume" : "Play";
    this.ui.play.classList.toggle("is-playing", playing);
    this.ui.play.setAttribute("aria-label", label);
    this.ui.play.title = `${label} (Space)`;
    this.ui.play.disabled = n === 0;
    this.ui.next.disabled = n === 0 || this.index >= n;
    this.ui.end.disabled = n === 0 || this.index >= n;
    this.ui.prev.disabled = n === 0 || this.index === 0;
    this.ui.reset.disabled = n === 0 || this.index === 0;
    this.ui.scrub.disabled = n === 0;
    this.ui.scrub.max = String(n);
    this.ui.scrub.value = String(this.index);
    this.ui.scrub.style.setProperty("--pct", `${String(n === 0 ? 0 : (this.index / n) * 100)}%`);
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
      } else if (event.key === "Home") {
        this.pause();
        this.goTo(0);
      } else if (event.key === "End") {
        this.pause();
        this.goTo(Number.MAX_SAFE_INTEGER);
      } else if (event.key === " " && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        this.togglePlay();
      } else {
        return;
      }
    });
  }

  // ---------- rendering ----------

  /** Empty label = idle: show "Ready" and the level's dimensions. */
  private setResult(label: string, stats: string, solved = false): void {
    if (label === "") {
      const boxes = this.level.box.reduce((a, b) => a + b, 0);
      label = "Ready";
      stats = `${String(this.level.width)}×${String(this.level.height)} · ${String(boxes)} ${boxes === 1 ? "box" : "boxes"}`;
    }
    this.ui.resultLabel.textContent = label;
    this.ui.resultStats.textContent = stats;
    this.ui.resultStats.title = stats;
    this.ui.result.classList.toggle("is-solved", solved);
  }

  /** Scrolls the moves box (not the page) so the current move stays in view. */
  private keepCurrentMoveVisible(): void {
    const span = this.moveSpans[Math.max(0, this.index - 1)];
    if (!span) return;
    const box = this.ui.moves;
    const top = span.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 4 || top + span.offsetHeight > box.scrollTop + box.clientHeight - 4) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  }

  private markStep(): void {
    const step = this.solution ? this.ui.stepWatch : this.job ? this.ui.stepSolve : null;
    for (const s of [this.ui.stepLevel, this.ui.stepSolve, this.ui.stepWatch]) {
      s.classList.toggle("is-current", s === step);
    }
  }

  /** Moves and pushes done so far; the clock is the time playback takes to get here. */
  private statusLine(): StatusLine {
    const presetIndex = LEVEL_PRESETS.findIndex((p) => p.id === this.ui.preset.value);
    const s = this.solution;
    let pushes = 0;
    for (let k = 0; s && k < this.index; k++) if (s.pushes[k]) pushes++;
    return {
      level: presetIndex >= 0 ? presetIndex + 1 : null,
      moves: s ? this.index : 0,
      pushes,
      seconds: s ? this.index / this.speed() : 0,
    };
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
      status: this.statusLine(),
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
      const stats = isSmallScreen()
        ? `${String(s.pushCount)} pushes · ${fmtMs(s.result.elapsedMs)}`
        : `${String(s.pushCount)} pushes · ${fmtInt(s.result.expanded)} states · ${fmtMs(s.result.elapsedMs)}`;
      const tail = this.index === 0 || solved ? stats : s.pushes[this.index - 1] ? "push" : "walk";
      this.setResult(head, tail, solved);
      this.moveSpans.forEach((span, k) => {
        span.className = k < this.index - 1 ? "done" : k === this.index - 1 ? "now" : "";
      });
      this.keepCurrentMoveVisible();
    } else if (!this.job) {
      this.setResult("", "");
    }
    this.updateTransport();
  }
}
