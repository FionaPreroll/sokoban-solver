// SPDX-License-Identifier: GPL-3.0-only
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        test: { name: "fuzz", include: ["tests/fuzz/**/*.test.ts"], environment: "node", testTimeout: 120_000 },
      },
      {
        test: {
          name: "soak",
          include: ["tests/soak/**/*.test.ts"],
          environment: "node",
          testTimeout: 30 * 60_000,
          pool: "forks",
          execArgv: ["--expose-gc"],
        },
      },
    ],
  },
});
