// SPDX-License-Identifier: GPL-3.0-only
import { expect, test, type Page } from "@playwright/test";

async function solveCurrent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.locator("#result")).toContainText("moves", { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("solves the default level optimally and plays it back to the solved state", async ({ page }) => {
  await solveCurrent(page);
  await expect(page.locator("#progress")).toContainText("53 moves");
  await expect(page.locator("#step-watch")).toHaveClass(/is-current/);
  await page.locator("#speed").fill("60");
  await page.locator("#speed").dispatchEvent("change");
  await page.locator("#play").click();
  await expect(page.locator("#result")).toContainText("Solved in 53 moves", { timeout: 10_000 });
  await expect(page.locator("#play")).toHaveText("Play");
});

test("steps forward and back, and the scrubber follows", async ({ page }) => {
  await solveCurrent(page);
  await page.locator("#next").click();
  await page.locator("#next").click();
  await expect(page.locator("#result")).toContainText("Move 2 / 53");
  await page.locator("#prev").click();
  await expect(page.locator("#result")).toContainText("Move 1 / 53");
  await expect(page.locator("#scrub")).toHaveValue("1");
  // Stepping to the very end used to crash (missing #stopAnimation element).
  await page.locator("#scrub").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#result")).toContainText("Solved in 53 moves");
  await expect(page.locator("#next")).toBeDisabled();
});

test("can stop a long search", async ({ page }) => {
  await page.locator("#preset").selectOption("mirror");
  // Make the search big enough to still be running when we press Stop.
  await page.locator("summary", { hasText: "Level as text" }).click();
  await page
    .locator("#level-text")
    .fill(
      ["##########", "#. . . . #", "# $$$$   #", "#   @    #", "# $$$$   #", "#. . . . #", "##########"].join("\n"),
    );
  await page.getByRole("button", { name: "Load text" }).click();
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.locator("#stop")).toBeVisible();
  await page.locator("#stop").click();
  await expect(page.locator("#progress")).toContainText("Stopped");
  await expect(page.locator("#solve")).toBeEnabled();
});

test("editing paints tiles, invalidates the solution and can be undone", async ({ page }) => {
  await solveCurrent(page);
  await page.locator("label.tool", { hasText: "Wall" }).click();
  const box = await page.locator("#board").boundingBox();
  if (!box) throw new Error("no board");
  // Cell (5, 1) of the 8x8 default level is floor.
  await page.mouse.click(box.x + (box.width / 8) * 5.5, box.y + (box.height / 8) * 1.5);
  await expect(page.locator("#result")).toBeEmpty();
  await expect(page.locator("#preset")).toHaveValue("custom");
  await expect(page.locator("#level-text")).toHaveValue(/\n {2}#### #\n/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#preset")).toHaveValue("classic");
});

test("the edited level survives a reload", async ({ page }) => {
  await page.locator("#preset").selectOption("warmup");
  await page.reload();
  await expect(page.locator("#preset")).toHaveValue("warmup");
});

test("theme can be switched and is remembered", async ({ page }) => {
  await page.getByRole("radio", { name: "Night theme" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.getByRole("radio", { name: "Night theme" })).toBeChecked();
});

test.describe("about dialog", () => {
  test("shows build, licence and third-party information", async ({ page }) => {
    await page.getByRole("button", { name: "About", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("GPL-3.0-only");
    await expect(dialog).toContainText("Commit");
    await expect(dialog).toContainText("Branch");
    await expect(dialog).toContainText("vite");
    await expect(dialog).toContainText("No third-party libraries run in this page");
    await expect(dialog.getByRole("link", { name: "Full licence texts" })).toHaveAttribute(
      "href",
      "./third-party-licenses.txt",
    );
  });

  test("closes with the × button, the Close button and a click outside", async ({ page }) => {
    const dialog = page.getByRole("dialog");
    const open = page.getByRole("button", { name: "About", exact: true });

    await open.click();
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();

    await open.click();
    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(dialog).toBeHidden();

    await open.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(dialog).toBeHidden();

    // A click inside must not close it.
    await open.click();
    await dialog.locator("h2").click();
    await expect(dialog).toBeVisible();
  });
});

test("the licence file is deployed", async ({ request }) => {
  const res = await request.get("./third-party-licenses.txt");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("Used for:");
});
