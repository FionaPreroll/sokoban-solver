// SPDX-License-Identifier: GPL-3.0-only
/** Every user-facing function, end to end. */
import { expect, test } from "@playwright/test";
import { parseLevel, serializeLevel } from "../../src/core/level.ts";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";
import { boxOf, currentLevel, failOnPageErrors, loadLevelText, solve } from "./helpers.ts";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = failOnPageErrors(page);
  await page.goto("./");
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const OPTIMAL: Record<string, number> = {
  classic: 53,
  warmup: 18,
  staircase: 34,
  cross: 38,
  zigzag: 55,
  mirror: 21,
  courtyard: 105,
};

test.describe("levels", () => {
  test("every preset loads, solves with the optimal move count, and the select follows", async ({ page }) => {
    for (const preset of LEVEL_PRESETS) {
      await page.locator("#preset").selectOption(preset.id);
      expect(serializeLevel(await currentLevel(page))).toEqual(serializeLevel(parseLevel(preset.rows)));
      await solve(page);
      await expect(page.locator("#result-label")).toHaveText(`Solution: ${String(OPTIMAL[preset.id])} moves`);
    }
  });

  test("the idle result line describes the level", async ({ page }) => {
    await expect(page.locator("#result-label")).toHaveText("Ready");
    await expect(page.locator("#result-stats")).toHaveText("8×8 · 4 boxes");
  });

  test("level text: load, error with position, copy to clipboard", async ({ page, context }) => {
    await loadLevelText(page, ["#####", "#@$.#", "#####"]);
    await expect(page.locator("#preset")).toHaveValue("custom");
    await expect(page.locator("#result-stats")).toHaveText("5×3 · 1 box");

    await loadLevelText(page, ["#####", "#@?.#", "#####"]);
    await expect(page.locator("#issues")).toContainText("Unknown character");
    await expect(page.locator("#issues")).toContainText("line 2, column 3");
    await expect(page.locator("#result-stats")).toHaveText("5×3 · 1 box"); // the old level stays

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#preset").selectOption("warmup");
    await page.getByRole("button", { name: "Copy", exact: true }).first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.split("\n")).toEqual(serializeLevel(parseLevel(LEVEL_PRESETS[1]?.rows ?? [])));
  });

  test("the old x _ p b o notation is accepted", async ({ page }) => {
    await loadLevelText(page, ["xxxxx", "xpbox", "xxxxx"]);
    expect(serializeLevel(await currentLevel(page))).toEqual(["#####", "#@$.#", "#####"]);
  });

  test("issues line warns about missing player and box/target mismatch", async ({ page }) => {
    await loadLevelText(page, ["#####", "# $.#", "#####"]);
    await expect(page.locator("#issues")).toHaveText("No player yet. Place one with the Player tile.");
    await loadLevelText(page, ["######", "#@$$.#", "######"]);
    await expect(page.locator("#issues")).toHaveText("2 boxes but 1 targets: not solvable.");
    await loadLevelText(page, ["######", "#@$..#", "######"]);
    await expect(page.locator("#issues")).toContainText("extra targets stay empty");
    await loadLevelText(page, ["#####", "#@$.#", "#####"]);
    await expect(page.locator("#issues")).toHaveText("");
  });
});

test.describe("editor", () => {
  /** Clicks the centre of cell (x, y) of a level with the given size. */
  async function clickCell(page: import("@playwright/test").Page, x: number, y: number, w: number, h: number) {
    const b = await boxOf(page.locator("#board"));
    await page.mouse.click(b.x + (b.width / w) * (x + 0.5), b.y + (b.height / h) * (y + 0.5));
  }

  test("each tool paints its tile; Off does not paint", async ({ page }) => {
    await loadLevelText(page, ["#######", "#@    #", "#     #", "#######"]);
    const paint = async (tool: string, x: number, y: number): Promise<void> => {
      await page.locator("label.tool", { hasText: tool }).click();
      await clickCell(page, x, y, 7, 4);
    };
    await paint("Wall", 2, 1);
    await paint("Box", 3, 1);
    await paint("Target", 4, 1);
    await paint("Target", 3, 2); // target first …
    await paint("Box", 3, 2); // … then a box on it: box on target
    await paint("Player", 5, 2); // moves the player
    await paint("Floor", 2, 1); // floor erases the wall again
    await expect(page.locator("#level-text")).toHaveValue(["#######", "#  $. #", "#  * @#", "#######"].join("\n"));
    await paint("Off", 1, 1);
    await expect(page.locator("#level-text")).toHaveValue(["#######", "#  $. #", "#  * @#", "#######"].join("\n"));
  });

  test("dragging paints a stroke, and one Undo removes the whole stroke", async ({ page }) => {
    await loadLevelText(page, ["#######", "#@    #", "#     #", "#######"]);
    await page.locator("label.tool", { hasText: "Wall" }).click();
    const b = await boxOf(page.locator("#board"));
    const at = (x: number, y: number): [number, number] => [
      b.x + (b.width / 7) * (x + 0.5),
      b.y + (b.height / 4) * (y + 0.5),
    ];
    await page.mouse.move(...at(2, 2));
    await page.mouse.down();
    for (const x of [3, 4, 5]) await page.mouse.move(...at(x, 2), { steps: 3 });
    await page.mouse.up();
    await expect(page.locator("#level-text")).toHaveValue(["#######", "#@    #", "# #####", "#######"].join("\n"));
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#level-text")).toHaveValue(["#######", "#@    #", "#     #", "#######"].join("\n"));
    // One more Undo goes back past the text load to the original level.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#preset")).toHaveValue("classic");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("size changes grow and shrink the level and can be undone", async ({ page }) => {
    await page.locator("#width").fill("10");
    await page.locator("#width").press("Tab");
    await page.locator("#height").fill("5");
    await page.locator("#height").press("Tab");
    const level = await currentLevel(page);
    expect([level.width, level.height]).toEqual([10, 5]);
    await expect(page.locator("#result-stats")).toHaveText(/^10×5/);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#preset")).toHaveValue("classic");
  });

  test("editing during playback stops it and clears the solution", async ({ page }) => {
    await solve(page);
    await page.locator("#play").click();
    await page.locator("label.tool", { hasText: "Wall" }).click();
    await clickCell(page, 5, 1, 8, 8);
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "Play");
    await expect(page.locator("#play")).toBeDisabled();
    await expect(page.locator("#copy-moves")).toBeDisabled();
    await expect(page.locator("#result-label")).toHaveText("Ready");
  });
});

test.describe("solving", () => {
  test("unsolvable and invalid levels say why", async ({ page }) => {
    await loadLevelText(page, ["#####", "#@$ #", "#. ##", "#####"]);
    await page.locator("#solve").click();
    await expect(page.locator("#result-label")).toHaveText("No solution");
    await expect(page.locator("#progress")).toContainText("No solution");

    await loadLevelText(page, ["#####", "# $.#", "#####"]);
    await page.locator("#solve").click();
    await expect(page.locator("#progress")).toHaveText("Place a player first.");
  });

  test("a level without boxes is already solved", async ({ page }) => {
    await loadLevelText(page, ["####", "#@ #", "####"]);
    await page.locator("#solve").click();
    await expect(page.locator("#result-label")).toHaveText("Already solved");
    await expect(page.locator("#moves")).toContainText("already solved");
  });

  test("Stop ends a long search at once; editing during a search cancels it", async ({ page }) => {
    const big = ["##########", "#. . . . #", "# $$$$   #", "#   @    #", "# $$$$   #", "#. . . . #", "##########"];
    await loadLevelText(page, big);
    await page.locator("#solve").click();
    await expect(page.locator("#board-panel")).toHaveClass(/is-solving/);
    await expect(page.locator("#result-label")).toHaveText("Searching…");
    await expect(page.locator("#step-solve")).toHaveClass(/is-current/);
    await page.locator("#stop").click();
    await expect(page.locator("#result-label")).toHaveText("Stopped");
    await expect(page.locator("#board-panel")).not.toHaveClass(/is-solving/);
    await expect(page.locator("#stop")).toBeDisabled();

    await page.locator("#solve").click();
    await expect(page.locator("#stop")).toBeEnabled();
    await page.locator("#preset").selectOption("warmup");
    await expect(page.locator("#stop")).toBeDisabled();
    await expect(page.locator("#result-label")).toHaveText("Ready");
  });

  test("progress is reported while searching", async ({ page }) => {
    await page.locator("#preset").selectOption("courtyard");
    await page.locator("#solve").click();
    await expect(page.locator("#result-stats")).toContainText("states");
    await expect(page.locator("#copy-moves")).toBeEnabled({ timeout: 30_000 });
  });
});

test.describe("playback", () => {
  test.beforeEach(async ({ page }) => {
    await solve(page);
  });

  test("transport buttons: next, previous, end, start, with correct disabled states", async ({ page }) => {
    await expect(page.locator("#prev")).toBeDisabled();
    await expect(page.locator("#reset")).toBeDisabled();
    await page.locator("#next").click();
    await page.locator("#next").click();
    await expect(page.locator("#result-label")).toHaveText("Move 2 / 53");
    await page.locator("#prev").click();
    await expect(page.locator("#result-label")).toHaveText("Move 1 / 53");
    await page.locator("#end").click();
    await expect(page.locator("#result-label")).toHaveText("Solved in 53 moves");
    await expect(page.locator("#result")).toHaveClass(/is-solved/);
    await expect(page.locator("#next")).toBeDisabled();
    await expect(page.locator("#end")).toBeDisabled();
    await page.locator("#reset").click();
    await expect(page.locator("#result-label")).toHaveText("Solution: 53 moves");
    await expect(page.locator("#scrub")).toHaveValue("0");
  });

  test("play, pause, resume, and replay from the end", async ({ page }) => {
    await page.getByRole("radio", { name: "32 moves per second" }).check();
    const play = page.locator("#play");
    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Pause");
    await expect(play).toHaveClass(/is-playing/);
    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Resume");
    const paused = await page.locator("#scrub").inputValue();
    await page.waitForTimeout(300);
    expect(await page.locator("#scrub").inputValue()).toBe(paused);
    await play.click();
    await expect(page.locator("#result-label")).toHaveText("Solved in 53 moves", { timeout: 10_000 });
    await expect(play).toHaveAttribute("aria-label", "Play");
    await play.click(); // from the end, play restarts at the beginning
    await expect(page.locator("#result-label")).toHaveText(/^Move \d+ \/ 53$/);
  });

  test("speed setting controls the playback rate", async ({ page }) => {
    await page.getByRole("radio", { name: "1 moves per second" }).check();
    await page.locator("#play").click();
    await page.waitForTimeout(1500);
    await page.locator("#play").click();
    const slow = Number(await page.locator("#scrub").inputValue());
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(slow).toBeLessThanOrEqual(2);

    await page.locator("#reset").click();
    await page.getByRole("radio", { name: "32 moves per second" }).check();
    await page.locator("#play").click();
    await page.waitForTimeout(1000);
    await page.locator("#play").click();
    expect(Number(await page.locator("#scrub").inputValue())).toBeGreaterThan(15);
  });

  test("the scrubber jumps to any position", async ({ page }) => {
    await page.locator("#scrub").focus();
    await page.keyboard.press("End");
    await expect(page.locator("#result-label")).toHaveText("Solved in 53 moves");
    await page.keyboard.press("Home");
    await expect(page.locator("#result-label")).toHaveText("Solution: 53 moves");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect(page.locator("#result-label")).toHaveText("Move 5 / 53");
  });

  test("keyboard shortcuts: arrows, Home, End and Space", async ({ page }) => {
    await page.locator("h1").click(); // focus away from controls
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#result-label")).toHaveText("Move 2 / 53");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#result-label")).toHaveText("Move 1 / 53");
    await page.keyboard.press("End");
    await expect(page.locator("#result-label")).toHaveText("Solved in 53 moves");
    await page.keyboard.press("Home");
    await expect(page.locator("#result-label")).toHaveText("Solution: 53 moves");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-label", "Pause");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).not.toHaveAttribute("aria-label", "Pause");
  });

  test("the moves list highlights the current move and copies in LURD notation", async ({ page, context }) => {
    await expect(page.locator("#moves span")).toHaveCount(53);
    await page.locator("#next").click();
    await page.locator("#next").click();
    await expect(page.locator("#moves span.now")).toHaveCount(1);
    await expect(page.locator("#moves span").nth(1)).toHaveClass("now");
    await expect(page.locator("#moves span.done")).toHaveCount(1);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#copy-moves").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^[udlrUDLR]{53}$/);
    expect(clip).toBe((await page.locator("#moves span").allTextContents()).join(""));
  });

  test("layers toggle: path, player, dead squares", async ({ page }) => {
    const pixels = (): Promise<string> =>
      page.evaluate(() => (document.getElementById("board") as HTMLCanvasElement).toDataURL());
    const base = await pixels();
    for (const id of ["#layer-path", "#layer-dead"]) {
      await page.locator(id).check({ force: true });
      expect(await pixels()).not.toBe(base);
      await page.locator(id).uncheck({ force: true });
      expect(await pixels()).toBe(base);
    }
    await page.locator("#layer-player").uncheck({ force: true });
    expect(await pixels()).not.toBe(base);
    await page.locator("#layer-player").check({ force: true });
    expect(await pixels()).toBe(base);
  });
});

test.describe("preferences", () => {
  test("every theme can be chosen and is remembered", async ({ page }) => {
    for (const [name, id] of [
      ["Night", "night"],
      ["Paper", "paper"],
      ["High contrast", "contrast"],
      ["Classic", "classic"],
    ] as const) {
      await page.getByRole("radio", { name: `${name} theme` }).check({ force: true });
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      await expect(page.getByRole("radio", { name: `${name} theme` })).toBeChecked();
    }
  });

  test("the edited level survives a reload", async ({ page }) => {
    await loadLevelText(page, ["#####", "#@$.#", "#####"]);
    await page.reload();
    await expect(page.locator("#preset")).toHaveValue("custom");
    expect(serializeLevel(await currentLevel(page))).toEqual(["#####", "#@$.#", "#####"]);
  });
});

test.describe("about dialog", () => {
  test("shows contact, build, licence and third-party information", async ({ page }) => {
    await page.getByRole("button", { name: "About", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Fiona");
    await expect(dialog.getByRole("link", { name: "fipreroll+app@gmail.com" })).toHaveAttribute(
      "href",
      "mailto:fipreroll+app@gmail.com",
    );
    for (const text of ["Commit", "Branch", "CI", "GPL-3.0-only", "github.com/FionaPreroll/sokoban-solver", "vite"]) {
      await expect(dialog).toContainText(text);
    }
    await expect(dialog.getByRole("link", { name: "Full licence texts" })).toHaveAttribute(
      "href",
      "./third-party-licenses.txt",
    );
  });

  test("closes with ×, Close, Escape and a click outside, but not a click inside", async ({ page }) => {
    const dialog = page.getByRole("dialog");
    const open = async (): Promise<void> => {
      await page.getByRole("button", { name: "About", exact: true }).click();
      await expect(dialog).toBeVisible();
    };
    await open();
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();
    await open();
    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(dialog).toBeHidden();
    await open();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await open();
    await page.mouse.click(3, 3);
    await expect(dialog).toBeHidden();
    await open();
    await dialog.locator("h2").click();
    await expect(dialog).toBeVisible();
  });

  test("the footer link opens it too", async ({ page }) => {
    await page.getByRole("button", { name: "About & licences" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test("the licence file is deployed", async ({ request }) => {
  const res = await request.get("./third-party-licenses.txt");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("Used for:");
});
