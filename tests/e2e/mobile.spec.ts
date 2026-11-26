// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "@playwright/test";

test("mobile: steps come in working order and the result is brought into view", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile layout only");
  await page.goto("./");
  const order = await page.locator(".step h2").allTextContents();
  expect(order.map((t) => t.trim().charAt(0))).toEqual(["1", "2", "3", "4"]);

  // Board first, then step 1.
  const boardTop = (await page.locator("#board-panel").boundingBox())?.y ?? Infinity;
  const step1Top = (await page.locator("#step-level").boundingBox())?.y ?? -Infinity;
  expect(boardTop).toBeLessThan(step1Top);

  await page.locator("#solve").scrollIntoViewIfNeeded();
  await page.locator("#solve").click();
  await expect(page.locator("#result")).toContainText("53 moves", { timeout: 30_000 });
  await expect(page.locator("#board-panel")).toHaveClass(/flash/);

  // Board (sticky) and the playback controls are both on screen without scrolling.
  await expect(async () => {
    const vh = page.viewportSize()?.height ?? 0;
    const board = await page.locator("#board").boundingBox();
    const play = await page.locator("#play").boundingBox();
    expect(board && board.y >= -1 && board.y + board.height <= vh).toBe(true);
    expect(play && play.y >= 0 && play.y + play.height <= vh).toBe(true);
  }).toPass({ timeout: 5000 });
});
