// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "@playwright/test";
import { boxOf, expectNoHorizontalOverflow, failOnPageErrors } from "./helpers.ts";

test.skip(({ isMobile }) => !isMobile, "mobile layout only");

test("steps come in working order below the board", async ({ page }) => {
  const errors = failOnPageErrors(page);
  await page.goto("./");
  const order = await page.locator(".step h2").allTextContents();
  expect(order.map((t) => t.trim().charAt(0))).toEqual(["1", "2", "3", "4"]);
  const tops = await Promise.all(
    ["#board-panel", "#step-level", "#step-solve", "#step-watch", "#step-layers"].map(
      async (s) => (await boxOf(page.locator(s))).y,
    ),
  );
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("after solving, the board and the playback controls are on screen together", async ({ page }) => {
  await page.goto("./");
  await page.locator("#solve").scrollIntoViewIfNeeded();
  await page.locator("#solve").click();
  await expect(page.locator("#result-label")).toHaveText("Solution: 53 moves", { timeout: 30_000 });
  await expect(page.locator("#board-panel")).toHaveClass(/flash/);
  await expect(async () => {
    const vh = page.viewportSize()?.height ?? 0;
    const board = await boxOf(page.locator("#board"));
    const play = await boxOf(page.locator("#play"));
    expect(board.y).toBeGreaterThanOrEqual(-1);
    expect(board.y + board.height).toBeLessThanOrEqual(vh);
    expect(play.y).toBeGreaterThan(board.y + board.height);
    expect(play.y + play.height).toBeLessThanOrEqual(vh);
  }).toPass({ timeout: 5000 });
});

test("the board stays pinned to the top while scrolling through the steps", async ({ page }) => {
  await page.goto("./");
  for (const y of [300, 700, 1200]) {
    await page.evaluate((top) => {
      window.scrollTo(0, top);
    }, y);
    const panel = await boxOf(page.locator("#board-panel"));
    expect(Math.round(panel.y)).toBeLessThanOrEqual(0);
    expect(panel.y + panel.height).toBeGreaterThan(200);
    // The panel is opaque and full-bleed, so nothing shows through or beside it.
    await expect(page.locator("#board-panel")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(Math.round(panel.width)).toBe(page.viewportSize()?.width);
  }
});

test("tapping and dragging on the board paints on touch screens", async ({ page }) => {
  await page.goto("./");
  await page.locator("label.tool", { hasText: "Wall" }).tap();
  const b = await boxOf(page.locator("#board"));
  await page.touchscreen.tap(b.x + (b.width / 8) * 5.5, b.y + (b.height / 8) * 1.5);
  await expect(page.locator("#level-text")).toHaveValue(/\n {2}#### #\n/);
});
