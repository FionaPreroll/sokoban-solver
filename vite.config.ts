// SPDX-License-Identifier: GPL-3.0-only
import { defineConfig } from "vite";
import { buildInfoPlugin } from "./build/build-info.ts";
import { thirdPartyPlugin } from "./build/third-party.ts";

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/sokoban-solver/) and locally.
  base: "./",
  plugins: [buildInfoPlugin(), thirdPartyPlugin()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
