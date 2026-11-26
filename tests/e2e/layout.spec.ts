// SPDX-License-Identifier: GPL-3.0-only
/**
 * Layout stability: nothing may jump, resize or overflow while the app is used.
 * Two independent checks: element rectangles before/after every interaction, and
 * Chromium's Layout Instability API over the whole session.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  failOnPageErrors,
  isMobile,
  loadLevelText,
  recordedShifts,
  rects,
  solve,
  startShiftRecorder,
  useTheme,
  type Rect,
} from "./helpers.ts";

/** Elements that must never move or change size while the level size stays the same. */
const FIXED = [
  "#board",
  ".board-frame",
  "#status-line",
  "#result",
  "#tools",
  "#solve",
  "#stop",
  "#progress",
  "#reset",
  "#prev",
  "#play",
  "#next",
  "#end",
  "#scrub",
  "#speed",
  "#moves",
  "#copy-moves",
  "#step-solve-title",
  "#step-watch-title",
  "#step-layers-title",
  "#layer-path",
  ".colophon",
];

/**
 * The board panel is sticky: when the app scrolls to the result its page position
 * changes by design. For these only the size is compared; their position on screen
 * is checked separately with the scroll position held still.
 */
const STICKY = new Set(["#board", ".board-frame", "#status-line", "#result"]);

async function snapshot(page: Page): Promise<Record<string, Rect | null>> {
  const all = await rects(page, FIXED);
  for (const sel of STICKY) {
    const r = all[sel];
    if (r) all[sel] = { x: r.x, y: 0, width: r.width, height: r.height };
  }
  return all;
}

/** Viewport rectangles of the sticky elements, for checks without scrolling. */
async function stickyOnScreen(page: Page): Promise<string> {
  return page.evaluate(
    (sels) =>
      sels
        .map((s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return r ? `${s}:${String(Math.round(r.top))},${String(Math.round(r.height))}` : `${s}:none`;
        })
        .join(" "),
    [...STICKY],
  );
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = failOnPageErrors(page);
  await page.goto("./");
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

for (const theme of ["classic", "cga"] as const) {
  test(`nothing moves while solving, playing, stepping, scrubbing and toggling (${theme} theme)`, async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo);
    if (theme !== "classic") await useTheme(page, theme);
    // Desktop: tall enough that Playwright never has to scroll to reach a control.
    if (!mobile) await page.setViewportSize({ width: 1280, height: 1500 });
    await page.locator("summary", { hasText: "Level as text" }).click(); // closed/open is the user's choice
    await startShiftRecorder(page);
    const base = await snapshot(page);
    const check = async (step: string): Promise<void> => {
      expect(await snapshot(page), `layout changed after: ${step}`).toEqual(base);
      await expectNoHorizontalOverflow(page);
    };

    await page.locator("#solve").click();
    await check("starting the search");
    await expect(page.locator("#copy-moves")).toBeEnabled({ timeout: 30_000 });
    await page.waitForTimeout(1500); // let the result highlight finish
    await check("the solution arriving");

    // From here on the app does not scroll by itself, so the sticky board must not move on screen either.
    // (On mobile the board is now stuck to the top of the screen and must stay there.)
    const sticky = await stickyOnScreen(page);
    const check2 = async (step: string): Promise<void> => {
      await check(step);
      expect(await stickyOnScreen(page), `board moved on screen after: ${step}`).toBe(sticky);
    };
    await page.locator("#play").click();
    await page.waitForTimeout(400);
    await check2("playing");
    await page.locator("#play").click();
    await check2("pausing (button shows Resume)");
    for (const id of ["#next", "#next", "#prev", "#end", "#reset"]) {
      await page.locator(id).click();
      await check2(`clicking ${id}`);
    }
    await page.locator("#scrub").focus();
    await page.keyboard.press("End");
    await check2("scrubbing to the end (Solved state)");
    for (const speed of ["32", "1", "4"]) {
      await page.getByRole("radio", { name: `${speed} moves per second` }).check({ force: true });
      await check2(`speed ${speed}`);
    }
    for (const id of ["#layer-path", "#layer-dead", "#layer-player"]) {
      await page.locator(id).click({ force: true });
      await check2(`toggling ${id}`);
      await page.locator(id).click({ force: true });
    }
    // The CGA theme has its own type and a 4:3 screen, so switching to or from it moves
    // things on purpose. The other themes only swap colours.
    if (theme === "classic") {
      for (const name of ["Night", "Paper", "High contrast", "Classic"]) {
        // Clicked via the DOM so Playwright does not scroll the header into view.
        await page.getByRole("radio", { name: `${name} theme` }).evaluate((el) => {
          (el as HTMLInputElement).click();
        });
        await check2(`theme ${name}`);
      }
    }
    for (const tool of ["Wall", "Floor", "Player", "Box", "Target", "Off"]) {
      await page.locator("label.tool", { hasText: tool }).click();
      await check2(`choosing the ${tool} tool`);
    }
    await page.getByRole("button", { name: "About", exact: true }).evaluate((el) => {
      (el as HTMLButtonElement).click();
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await check2("opening and closing About");

    // Playing to the end, the moves list scrolls inside its box, never the page.
    await page.locator("#reset").click();
    await page.getByRole("radio", { name: "32 moves per second" }).check({ force: true });
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.locator("#play").click();
    await expect(page.locator("#result-label")).toHaveText(/^Solved in/, { timeout: 10_000 });
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    await check2("playing to the end");

    if (!mobile) {
      // On desktop nothing is allowed to shift at all, not even right after input.
      // (On mobile the page scrolls to the result on purpose, which is not a shift.)
      const shifts = await recordedShifts(page);
      expect(shifts, JSON.stringify(shifts)).toEqual([]);
    }
  });
}

test("hovering and pressing controls does not move anything", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "no hover on touch screens");
  await page.setViewportSize({ width: 1280, height: 1400 }); // everything on screen, so hover never scrolls
  await solve(page);
  const base = await snapshot(page);
  const sticky = await stickyOnScreen(page);
  for (const sel of ["#solve", "#play", "#next", "#copy-moves", "#open-about", ".tool", ".chip", "#scrub"]) {
    await page.locator(sel).first().hover();
    expect(await snapshot(page), `hover ${sel}`).toEqual(base);
    expect(await stickyOnScreen(page), `hover ${sel}`).toBe(sticky);
  }
});

test("messages of any length keep their reserved space", async ({ page }) => {
  // Open the text box first: expanding it moves things on purpose.
  await page.locator("summary", { hasText: "Level as text" }).click();
  const base = await snapshot(page);
  // Same size level, so the board may stay put; issue line and progress text change.
  await loadLevelText(page, [
    "########",
    "#  $  .#",
    "#      #",
    "# $$  .#",
    "#      #",
    "#  $   #",
    "#      #",
    "########",
  ]);
  await expect(page.locator("#issues")).not.toBeEmpty();
  const withIssue = await snapshot(page);
  for (const sel of ["#solve", "#progress", "#step-watch-title", "#play", "#moves"]) {
    expect(withIssue[sel], sel).toEqual(base[sel]);
  }
  await page.locator("#solve").click();
  await expect(page.locator("#progress")).toHaveText("Place a player first.");
  const after = await snapshot(page);
  for (const sel of ["#step-watch-title", "#play", "#moves"]) expect(after[sel], sel).toEqual(base[sel]);
});

test("a long solution does not grow the page", async ({ page }) => {
  await page.locator("#preset").selectOption("courtyard");
  const base = await snapshot(page);
  await solve(page);
  await page.waitForTimeout(1500);
  const after = await snapshot(page);
  for (const sel of ["#moves", "#step-layers-title", ".colophon"]) expect(after[sel], sel).toEqual(base[sel]);
  // The moves box scrolls internally and keeps the current move visible.
  await page.locator("#scrub").focus();
  await page.keyboard.press("End");
  const visible = await page.evaluate(() => {
    const box = document.getElementById("moves") as HTMLElement;
    const now = box.querySelector<HTMLElement>(".now");
    if (!now) return false;
    const b = box.getBoundingClientRect();
    const r = now.getBoundingClientRect();
    return r.top >= b.top && r.bottom <= b.bottom;
  });
  expect(visible).toBe(true);
});

test("the result line keeps one height for every message", async ({ page }) => {
  const h = async (): Promise<number> => (await rects(page, ["#result"]))["#result"]?.height ?? -1;
  const base = await h();
  await loadLevelText(page, ["#####", "#@$ #", "#. ##", "#####"]);
  await page.locator("#solve").click();
  await expect(page.locator("#result-label")).toHaveText("No solution");
  expect(await h()).toBe(base);
  await page.locator("#preset").selectOption("courtyard");
  await solve(page);
  expect(await h()).toBe(base);
  await expect(page.locator("#result")).toHaveCSS("white-space", "nowrap");
});

test("the board is never cut off and fits the viewport", async ({ page }) => {
  for (const id of ["classic", "courtyard", "mirror"]) {
    await page.locator("#preset").selectOption(id);
    const vp = page.viewportSize();
    const fr = await rects(page, [".board-frame", "#board"]);
    const frame = fr[".board-frame"];
    const board = fr["#board"];
    if (!vp || !frame || !board) throw new Error("missing");
    expect(board.x).toBeGreaterThanOrEqual(frame.x);
    expect(board.x + board.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(board.height).toBeLessThanOrEqual(vp.height * 0.75);
    expect(board.width).toBeLessThanOrEqual(vp.width);
  }
  await expectNoHorizontalOverflow(page);
});
