// SPDX-License-Identifier: GPL-3.0-only
/**
 * End-to-end before/after in real Chromium: time from clicking the solve button to
 * the result being shown. "Before" is the untouched legacy page (legacy/index.html),
 * including its `await delay(0)` every 100 states; "after" is the built app (dist/).
 *
 *   pnpm build && node bench/browser.ts [--legacy-timeout 120]
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { preview } from "vite";
import { parseLevel, serializeLevel } from "../src/core/level.ts";
import { LEVEL_PRESETS } from "../src/core/levels.ts";

const { values } = parseArgs({ options: { "legacy-timeout": { type: "string", default: "120" } } });
const legacyTimeoutMs = Number(values["legacy-timeout"]) * 1000;

const toLegacyRows = (rows: readonly string[]): string[] => {
  const map: Record<string, string> = { "#": "x", " ": "_", "@": "p", $: "b", ".": "o" };
  return serializeLevel(parseLevel(rows)).map((r) => r.replace(/[# @$.]/g, (c) => map[c] ?? c));
};

async function timeLegacy(page: Page, rows: string[]): Promise<number | null> {
  await page.goto(pathToFileURL("legacy/index.html").href);
  await page.evaluate((r) => {
    // Globals of the legacy script. A fresh solver is needed because the old one kept
    // the start level from construction time (one of the legacy bugs).
    const w = window as unknown as Record<string, unknown> & {
      _updateBaseMap: (rows: string[]) => void;
      SokobanSolver: new (rows: string[]) => unknown;
    };
    w._updateBaseMap(r);
    // The legacy globals are `let` bindings, reachable only from script code.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const assign = new Function("rows", "_solver = new SokobanSolver(rows); currentGrid = [...rows];") as (
      rows: string[],
    ) => void;
    assign(r);
  }, rows);
  const t0 = Date.now();
  await page.click("#calculatePath");
  try {
    await page.waitForFunction(() => (document.getElementById("bfsText")?.innerText ?? "").endsWith("steps"), null, {
      timeout: legacyTimeoutMs,
      polling: 50,
    });
  } catch {
    return null;
  }
  return Date.now() - t0;
}

async function timeNew(page: Page, base: string, rows: readonly string[]): Promise<number> {
  await page.goto(base);
  await page.locator("summary", { hasText: "Level as text" }).click();
  await page.locator("#level-text").fill(rows.join("\n"));
  await page.getByRole("button", { name: "Load text" }).click();
  const t0 = Date.now();
  await page.locator("#solve").click();
  await page.locator("#copy-moves:not([hidden])").waitFor({ timeout: 120_000 });
  return Date.now() - t0;
}

const server = await preview({ preview: { port: 4176, host: "127.0.0.1", strictPort: true }, logLevel: "warn" });
const browser = await chromium.launch();
const page = await browser.newPage();
const fmt = (ms: number): string => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${String(ms)} ms`);
const lines = ["| Level | Before (legacy page) | After | Speed-up |", "|---|---:|---:|---:|"];
try {
  for (const preset of LEVEL_PRESETS) {
    const after = Math.min(
      await timeNew(page, "http://127.0.0.1:4176/", preset.rows),
      await timeNew(page, "http://127.0.0.1:4176/", preset.rows),
    );
    const before = await timeLegacy(page, toLegacyRows(preset.rows));
    const speedup =
      before === null ? `> ${String(Math.floor(legacyTimeoutMs / after))}×` : `${String(Math.round(before / after))}×`;
    lines.push(
      `| ${preset.id} | ${before === null ? `> ${fmt(legacyTimeoutMs)}` : fmt(before)} | ${fmt(after)} | ${speedup} |`,
    );
    console.error(`${preset.id}: done`);
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => {
      resolve();
    }),
  );
}
console.log(`Chromium, click → result shown, includes worker start-up.\n`);
console.log(lines.join("\n"));
