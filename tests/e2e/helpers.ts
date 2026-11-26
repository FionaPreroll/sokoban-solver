// SPDX-License-Identifier: GPL-3.0-only
/** Shared helpers for the browser tests. */
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { fromLurd, replay, type GameState } from "../../src/core/game.ts";
import { parseLevel, type Level } from "../../src/core/level.ts";

/** Fails the test on any uncaught page error or console error. */
export function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export async function solve(page: Page): Promise<void> {
  await page.locator("#solve").click();
  await expect(page.locator("#copy-moves")).toBeEnabled({ timeout: 30_000 });
}

export async function loadLevelText(page: Page, rows: readonly string[]): Promise<void> {
  const details = page.locator("details.io");
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await page.locator("summary", { hasText: "Level as text" }).click();
  }
  await page.locator("#level-text").fill(rows.join("\n"));
  await page.getByRole("button", { name: "Load text" }).click();
}

export async function currentLevel(page: Page): Promise<Level> {
  return parseLevel(await page.locator("#level-text").inputValue());
}

/** The game state the board should show: level start + the first `scrub` moves. */
export async function expectedState(page: Page): Promise<{ level: Level; state: GameState }> {
  const level = await currentLevel(page);
  const lurd = (await page.locator("#moves span:not(.placeholder)").allTextContents()).join("");
  const index = Number(await page.locator("#scrub").inputValue());
  const states = replay(level, fromLurd(lurd)).states;
  const state = states[Math.min(index, states.length - 1)];
  if (!state) throw new Error("no state");
  return { level, state };
}

/** Expected tile per cell: # wall, space floor, . target, $ box, * box on target, @ player. */
export function expectedTiles(level: Level, state: GameState, showPlayer = true): string[] {
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = "";
    for (let x = 0; x < level.width; x++) {
      const i = y * level.width + x;
      if (level.wall[i]) row += "#";
      else if (state.box[i]) row += level.target[i] ? "*" : "$";
      else if (showPlayer && state.player === i) row += "@";
      else row += level.target[i] ? "." : " ";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Reads the canvas back and classifies each cell by sampling its centre and a point
 * between the box edge and the crate frame. Unknown colours become "?".
 */
export async function readBoard(page: Page, width: number, height: number): Promise<string[]> {
  return page.evaluate(
    ({ width, height }) => {
      const canvas = document.getElementById("board") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const css = getComputedStyle(document.documentElement);
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) throw new Error("no probe");
      const rgb = (name: string): number[] => {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = css.getPropertyValue(`--${name}`).trim();
        probe.fillRect(0, 0, 1, 1);
        return Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const pal = {
        wall: rgb("wall"),
        floor: rgb("floor"),
        box: rgb("box"),
        target: rgb("target"),
        player: rgb("player"),
        page: rgb("page"),
      };
      const near = (a: number[], b: number[]): boolean => a.every((v, k) => Math.abs(v - (b[k] ?? 0)) <= 6);
      const cs = canvas.width / width;
      const px = (fx: number, fy: number): number[] =>
        Array.from(ctx.getImageData(Math.floor(fx), Math.floor(fy), 1, 1).data.slice(0, 3));
      const rows: string[] = [];
      for (let y = 0; y < height; y++) {
        let row = "";
        for (let x = 0; x < width; x++) {
          const c = px((x + 0.5) * cs, (y + 0.5) * cs);
          const z = px((x + 0.5) * cs, (y + 0.17) * cs);
          if (near(z, pal.box)) row += near(c, pal.target) ? "*" : "$";
          else if (near(c, pal.wall) && near(z, pal.wall)) row += "#";
          else if (near(c, pal.player)) row += "@";
          else if (near(c, pal.target)) row += ".";
          else if (near(c, pal.floor) || near(c, pal.page))
            row += " "; // page = unreachable floor
          else row += "?";
        }
        rows.push(row);
      }
      return rows;
    },
    { width, height },
  );
}

/** Board pixels must match the game state for the current position. */
export async function expectBoardMatchesState(page: Page, showPlayer = true): Promise<void> {
  const { level, state } = await expectedState(page);
  await expect
    .poll(async () => (await readBoard(page, level.width, level.height)).join("\n"), { timeout: 3000 })
    .toBe(expectedTiles(level, state, showPlayer).join("\n"));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Page-coordinate rectangles (scroll-independent) of the given selectors. */
export async function rects(page: Page, selectors: readonly string[]): Promise<Record<string, Rect | null>> {
  return page.evaluate((sels) => {
    const out: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) {
        out[sel] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const round = (v: number): number => Math.round(v * 2) / 2;
      out[sel] = {
        x: round(r.left + window.scrollX),
        y: round(r.top + window.scrollY),
        width: round(r.width),
        height: round(r.height),
      };
    }
    return out;
  }, selectors);
}

/**
 * Starts recording layout shifts (Chromium's Layout Instability API). Every shift is
 * recorded, including those right after input, which the CLS metric would forgive.
 */
export async function startShiftRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & {
          value: number;
          sources?: { node?: Node | null }[];
        };
        const sources = (e.sources ?? []).map((s) => {
          const n = s.node;
          if (n instanceof Element) return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}.${n.className}`;
          return n?.nodeName ?? "?";
        });
        w.__shifts.push({ value: e.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: false });
  });
}

export async function recordedShifts(page: Page): Promise<{ value: number; sources: string[] }[]> {
  return page.evaluate(() => (window as unknown as { __shifts: { value: number; sources: string[] }[] }).__shifts);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "page must not scroll sideways").toBeLessThanOrEqual(client);
}

export async function boxOf(locator: Locator): Promise<Rect> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element not visible");
  return b;
}

export function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === "mobile";
}
