// SPDX-License-Identifier: GPL-3.0-only
/**
 * The CGA theme: pixel-art tiles that still show exactly the game state, a 4:3 screen
 * with a status line in the IBM CGA font, and a layout that stays put like the others.
 */
import { expect, test, type Page } from "@playwright/test";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";
import {
  currentLevel,
  expectBoardMatchesState,
  expectNoHorizontalOverflow,
  failOnPageErrors,
  loadLevelText,
  readBoard,
  readStatusLine,
  solve,
  useTheme,
} from "./helpers.ts";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = failOnPageErrors(page);
  await page.goto("./");
  await useTheme(page, "cga");
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Moves, pushes and the clock the status line should show after `index` moves. */
async function expectedStatus(page: Page, level: string, index: number, speed: number): Promise<string> {
  const lurd = (await page.locator("#moves").textContent()) ?? "";
  const pushes = (lurd.slice(0, index).match(/[A-Z]/g) ?? []).length;
  const s = Math.floor(index / speed);
  const clock = `${String(Math.floor(s / 3600))}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const pad4 = (n: number): string => String(n).padStart(4, "0");
  return ` ${level}▐ moves:${pad4(index)} pushes:${pad4(pushes)} time:${clock}`.padEnd(40);
}

test("the theme is listed, chosen and remembered", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cga");
  await expect(page.getByRole("radio", { name: "CGA theme" })).toBeChecked();
  await page.getByRole("radio", { name: "Classic theme" }).check({ force: true });
  await expect(page.locator("#status-line")).toBeHidden();
  await page.getByRole("radio", { name: "CGA theme" }).check({ force: true });
  await expect(page.locator("#status-line")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cga");
});

test("every preset is drawn exactly as defined", async ({ page }) => {
  for (const preset of LEVEL_PRESETS) {
    await page.locator("#preset").selectOption(preset.id);
    await expectBoardMatchesState(page);
  }
});

test("boxes and the player on targets are drawn distinctly", async ({ page }) => {
  await loadLevelText(page, ["######", "#+*$.#", "######"]);
  const level = await currentLevel(page);
  expect(await readBoard(page, level.width, level.height)).toEqual(["######", "#@*$.#", "######"]);
  await page.locator("#layer-player").uncheck({ force: true });
  expect((await readBoard(page, level.width, level.height))[1]).toBe("#.*$.#");
});

test("playback shows the right state and status line at every step", async ({ page }) => {
  await page.locator("#preset").selectOption("warmup");
  await solve(page);
  const n = Number(await page.locator("#scrub").getAttribute("max"));
  for (let k = 0; k <= n; k++) {
    await expectBoardMatchesState(page);
    expect(await readStatusLine(page)).toBe(await expectedStatus(page, "02", k, 4));
    if (k < n) await page.keyboard.press("ArrowRight");
  }
});

test("status line: level number, moves, pushes and the clock at the chosen speed", async ({ page }) => {
  expect(await readStatusLine(page)).toBe(" 01▐ moves:0000 pushes:0000 time:0:00:00");
  await solve(page);
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  expect(await readStatusLine(page)).toBe(await expectedStatus(page, "01", 20, 4));
  expect(await readStatusLine(page)).toContain("time:0:00:05");
  await page.getByRole("radio", { name: "1 moves per second" }).check({ force: true });
  expect(await readStatusLine(page)).toContain("time:0:00:20");
  await page.locator("#end").click();
  const n = Number(await page.locator("#scrub").getAttribute("max"));
  expect(await readStatusLine(page)).toBe(await expectedStatus(page, "01", n, 1));
  await loadLevelText(page, ["#####", "#@$.#", "#####"]);
  expect(await readStatusLine(page)).toBe(" --▐ moves:0000 pushes:0000 time:0:00:00");
});

test("the screen is 4:3 with the status line along its bottom edge", async ({ page }) => {
  for (const preset of ["classic", "courtyard", "staircase"]) {
    await page.locator("#preset").selectOption(preset);
    const box = await page.evaluate(() => {
      const r = (id: string): DOMRect => (document.getElementById(id) as HTMLElement).getBoundingClientRect();
      const frame = document.getElementById("board-frame") as HTMLElement;
      return {
        frame: r("board-frame"),
        inner: { width: frame.clientWidth, height: frame.clientHeight },
        board: r("board"),
        status: r("status-line"),
      };
    });
    expect(Math.abs(box.inner.width / box.inner.height - 4 / 3)).toBeLessThan(0.01);
    expect(Math.abs(box.status.width - box.inner.width)).toBeLessThan(1);
    expect(Math.abs(box.status.bottom - (box.frame.bottom - 1))).toBeLessThan(1); // above the 1px border
    expect(box.board.bottom).toBeLessThanOrEqual(box.status.top);
    expect(box.board.top).toBeGreaterThanOrEqual(box.frame.top);
    expect(box.board.left).toBeGreaterThanOrEqual(box.frame.left);
    expect(box.board.right).toBeLessThanOrEqual(box.frame.right);
  }
  await expectNoHorizontalOverflow(page);
});

test("switching between CGA and another theme keeps the board in sync", async ({ page }) => {
  await solve(page);
  await page.keyboard.press("ArrowRight");
  await page.getByRole("radio", { name: "Night theme" }).check({ force: true });
  await expectBoardMatchesState(page);
  await page.getByRole("radio", { name: "CGA theme" }).check({ force: true });
  await expectBoardMatchesState(page);
  expect(await readStatusLine(page)).toBe(await expectedStatus(page, "01", 1, 4));
});
