// SPDX-License-Identifier: GPL-3.0-only
/**
 * Runs the unmodified legacy solver (legacy/sokoban-solver.js) in a Node vm
 * context with a minimal DOM stub, so "before" numbers come from the original
 * code and not from a re-implementation.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const LEGACY_SOURCE = readFileSync(new URL("../legacy/sokoban-solver.js", import.meta.url), "utf8");

function stubElement(): Record<string, unknown> {
  const noop = (): void => undefined;
  const ctx2d = new Proxy({}, { get: () => noop, set: () => true });
  return {
    style: {},
    dataset: {},
    innerText: "",
    innerHTML: "",
    checked: false,
    value: "",
    parentElement: { style: {} },
    addEventListener: noop,
    appendChild: noop,
    getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    width: 320,
    height: 320,
  };
}

export interface LegacyResult {
  steps: string[];
  visited: number;
}

export interface LegacyOptions {
  /** Keep the original `await delay(0)` every 100 states (as shipped). */
  yields: boolean;
}

export function createLegacySolver(options: LegacyOptions): (rows: string[]) => Promise<LegacyResult> {
  const elements = new Map<string, Record<string, unknown>>();
  const sandbox: Record<string, unknown> = {
    console: { log: () => undefined, error: () => undefined },
    setTimeout,
    clearInterval,
    setInterval,
    Promise,
    alert: (msg: string) => {
      throw new Error(msg);
    },
    requestAnimationFrame: () => 0,
    document: {
      getElementById: (id: string) => {
        let el = elements.get(id);
        if (!el) {
          el = stubElement();
          elements.set(id, el);
        }
        return el;
      },
      createElement: () => stubElement(),
      body: { style: {} },
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(LEGACY_SOURCE, context, { filename: "legacy/sokoban-solver.js" });
  if (!options.yields) {
    vm.runInContext("delay = () => Promise.resolve();", context);
  }
  const run = vm.runInContext(
    `(async (rows) => {
       _updateBaseMap(rows);
       const solver = new SokobanSolver(_baseMap);
       const steps = await solver.bfs(1, false);
       return { steps, visited: solver.visitedStates };
     })`,
    context,
  ) as (rows: string[]) => Promise<LegacyResult>;
  return (rows) => run(rows);
}
