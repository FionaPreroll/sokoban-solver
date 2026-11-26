// SPDX-License-Identifier: GPL-3.0-only
import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${String(port)}/`,
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${String(port)} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: !process.env["CI"],
  },
});
