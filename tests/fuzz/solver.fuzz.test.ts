// SPDX-License-Identifier: GPL-3.0-only
/**
 * Property-based fuzz tests. Seeds are random per run; a failure prints the seed
 * and the shrunk level so it can be reproduced with FUZZ_SEED=<seed>.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, initialState, isSolved, replay, step } from "../../src/core/game.ts";
import { countOf, parseLevel, serializeLevel, type Level } from "../../src/core/level.ts";
import { solve } from "../../src/core/solver.ts";
import { arbLevel, arbPuzzle } from "../helpers/arbitraries.ts";
import { referenceSolve } from "../helpers/reference-solver.ts";

const runs = Number(process.env["FUZZ_RUNS"] ?? 400);
const seed = process.env["FUZZ_SEED"] === undefined ? undefined : Number(process.env["FUZZ_SEED"]);
const params = { numRuns: runs, ...(seed === undefined ? {} : { seed }) };
const show = (l: Level): string => serializeLevel(l).join("\n");

describe("fuzz: solver against the naive reference", () => {
  it.each([
    ["random levels", arbLevel()],
    ["puzzle-like levels", arbPuzzle()],
  ])("%s: solution exists exactly when the reference finds one, with the same optimal length", (_name, arb) => {
    fc.assert(
      fc.property(arb, (level) => {
        const ref = referenceSolve(level);
        fc.pre(ref.exhausted);
        const got = solve(level);
        const ctx = `\n${show(level)}\n`;
        if (ref.moves === null) {
          expect(["unsolvable", "invalid"], ctx).toContain(got.status);
        } else {
          expect(got.status, ctx).toBe("solved");
          expect(got.moves.length, ctx).toBe(ref.moves.length);
          const r = replay(level, got.moves);
          expect(r.firstInvalid, ctx).toBe(-1);
          expect(isSolved(level, r.states[r.states.length - 1] ?? initialState(level)), ctx).toBe(true);
        }
      }),
      params,
    );
  });

  it("pruning never changes the answer", () => {
    fc.assert(
      fc.property(arbLevel({ maxWidth: 6, maxHeight: 6, maxBoxes: 3 }), (level) => {
        const a = solve(level, { pruning: true, maxStates: 300_000 });
        const b = solve(level, { pruning: false, maxStates: 300_000 });
        fc.pre(a.status !== "limit" && b.status !== "limit");
        expect(a.status, show(level)).toBe(b.status);
        expect(a.moves.length, show(level)).toBe(b.moves.length);
      }),
      params,
    );
  });
});

describe("fuzz: rules and notation", () => {
  it("random walks keep box count and never put boxes into walls", () => {
    fc.assert(
      fc.property(arbLevel(), fc.array(fc.constantFrom(...DIRECTIONS), { maxLength: 60 }), (level, moves) => {
        fc.pre(level.player >= 0);
        const n = countOf(level.box);
        let s = initialState(level);
        for (const d of moves) {
          const r = step(level, s, d);
          if (!r.moved) expect(r.state).toBe(s);
          s = r.state;
          expect(countOf(s.box)).toBe(n);
          expect(level.wall[s.player]).toBe(0);
          expect(s.box[s.player]).toBe(0);
          s.box.forEach((b, i) => {
            if (b) expect(level.wall[i]).toBe(0);
          });
        }
      }),
      params,
    );
  });

  it("serialise → parse is the identity", () => {
    fc.assert(
      fc.property(arbLevel({ maxWidth: 12, maxHeight: 10, maxBoxes: 6 }), (level) => {
        fc.pre(level.player < 0 || level.box[level.player] === 0);
        fc.pre(serializeLevel(level).some((r) => r.trim() !== ""));
        const text = serializeLevel(level);
        expect(parseLevel(text)).toEqual(level);
      }),
      params,
    );
  });

  it("the parser never throws anything but LevelParseError on garbage", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        try {
          parseLevel(text);
        } catch (e) {
          expect((e as Error).name).toBe("LevelParseError");
        }
      }),
      params,
    );
  });
});
