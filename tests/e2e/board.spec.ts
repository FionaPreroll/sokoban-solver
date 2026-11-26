// SPDX-License-Identifier: GPL-3.0-only
/**
 * The board must show exactly the game state: the canvas is read back pixel by pixel
 * and every cell is compared with the state computed by the game rules.
 */
import { expect, test } from "@playwright/test";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";
import {
  currentLevel,
  expectBoardMatchesState,
  expectedState,
  expectedTiles,
  failOnPageErrors,
  loadLevelText,
  readBoard,
  solve,
} from "./helpers.ts";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = failOnPageErrors(page);
  await page.goto("./");
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("every preset is drawn exactly as defined", async ({ page }) => {
  for (const preset of LEVEL_PRESETS) {
    await page.locator("#preset").selectOption(preset.id);
    await expectBoardMatchesState(page);
  }
});

test("boxes and the player on targets are drawn distinctly", async ({ page }) => {
  await loadLevelText(page, ["######", "#+*$.#", "######"]);
  await expectBoardMatchesState(page);
  const level = await currentLevel(page);
  expect(await readBoard(page, level.width, level.height)).toEqual(["######", "#@*$.#", "######"]);
});

for (const theme of ["classic", "night", "paper", "contrast"] as const) {
  test(`playback shows the right state at every step (${theme} theme)`, async ({ page }) => {
    await page.evaluate((t) => {
      localStorage.setItem("sokoban-solver:theme", t);
    }, theme);
    await page.reload();
    await page.locator("#preset").selectOption("warmup");
    await solve(page);
    const n = Number(await page.locator("#scrub").getAttribute("max"));
    for (let k = 0; k <= n; k++) {
      await expectBoardMatchesState(page);
      if (k < n) await page.keyboard.press("ArrowRight");
    }
    await expect(page.locator("#result-label")).toHaveText(`Solved in ${String(n)} moves`);
    // Final state: every box on a target.
    const { level, state } = await expectedState(page);
    expect(expectedTiles(level, state).join("")).not.toContain("$");
  });
}

test("jumping around with the scrubber and while playing keeps the board in sync", async ({ page }) => {
  await solve(page);
  for (const key of ["End", "Home", "PageUp", "End"]) {
    await page.locator("#scrub").focus();
    await page.keyboard.press(key);
    await expectBoardMatchesState(page);
  }
  await page.locator("#reset").click();
  await page.getByRole("radio", { name: "8 moves per second" }).check({ force: true });
  await page.locator("#play").click();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(170);
    await page.locator("#play").click(); // pause
    await expectBoardMatchesState(page);
    await page.locator("#play").click(); // resume
  }
});

test("hiding the player shows the floor or target under it (legacy bug: blue square)", async ({ page }) => {
  await loadLevelText(page, ["######", "#+$ .#", "#    #", "######"]);
  await page.locator("#layer-player").uncheck({ force: true });
  await expectBoardMatchesState(page, false);
  const level = await currentLevel(page);
  expect((await readBoard(page, level.width, level.height))[1]).toBe("#.$ .#");
});

test("walls join without hairline seams", async ({ page }) => {
  // Fractional device pixel ratios are where seams used to appear.
  await page.locator("#preset").selectOption("classic");
  const seams = await page.evaluate(() => {
    const canvas = document.getElementById("board") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
    const level = (document.getElementById("level-text") as HTMLTextAreaElement).value.split("\n");
    const w = Math.max(...level.map((r) => r.length));
    const cs = canvas.width / w;
    let bad = 0;
    for (let y = 0; y < level.length; y++) {
      for (let x = 0; x + 1 < w; x++) {
        if (level[y]?.[x] !== "#" || level[y]?.[x + 1] !== "#") continue;
        const bx = (x + 1) * cs;
        const cy = Math.floor((y + 0.5) * cs);
        const a = ctx.getImageData(bx - 1, cy, 1, 1).data;
        const b = ctx.getImageData(bx, cy, 1, 1).data;
        const centre = ctx.getImageData(Math.floor((x + 0.5) * cs), cy, 1, 1).data;
        for (const px of [a, b]) {
          if (Math.abs((px[0] ?? 0) - (centre[0] ?? 0)) > 2 || Math.abs((px[1] ?? 0) - (centre[1] ?? 0)) > 2) bad++;
        }
      }
    }
    return bad;
  });
  expect(seams).toBe(0);
});

test("the canvas is sized in whole device pixels per cell", async ({ page }) => {
  for (const preset of LEVEL_PRESETS) {
    await page.locator("#preset").selectOption(preset.id);
    const level = await currentLevel(page);
    const { w, h } = await page.evaluate(() => {
      const c = document.getElementById("board") as HTMLCanvasElement;
      return { w: c.width, h: c.height };
    });
    expect(w % level.width).toBe(0);
    expect(h % level.height).toBe(0);
    expect(w / level.width).toBe(h / level.height);
  }
});

test("theme switch redraws the board in the new colours", async ({ page }) => {
  await page.getByRole("radio", { name: "Night theme" }).check({ force: true });
  await expectBoardMatchesState(page);
  await page.getByRole("radio", { name: "High contrast theme" }).check({ force: true });
  await expectBoardMatchesState(page);
});
