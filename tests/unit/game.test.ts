// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import { fromLurd, initialState, isSolved, replay, step, toLurd } from "../../src/core/game.ts";
import { parseLevel } from "../../src/core/level.ts";

describe("step", () => {
  const level = parseLevel(["#######", "#@$ $.#", "#######"]);

  it("walks, pushes, and refuses blocked pushes", () => {
    const s0 = initialState(level);
    const r1 = step(level, s0, "R");
    expect(r1).toMatchObject({ moved: true, pushed: true });
    expect(r1.state.box[10]).toBe(1);
    const r2 = step(level, r1.state, "R");
    expect(r2.moved).toBe(false);
    expect(r2.state).toBe(r1.state);
    expect(step(level, s0, "U").moved).toBe(false);
  });

  it("treats the outside of the grid as wall (legacy bug: threw out of bounds)", () => {
    const open = parseLevel(["@$ "]);
    let s = initialState(open);
    s = step(open, s, "R").state;
    expect(step(open, s, "R").moved).toBe(false);
    expect(step(open, s, "U").moved).toBe(false);
    expect(step(open, initialState(open), "L").moved).toBe(false);
  });

  it("does nothing without a player", () => {
    const l = parseLevel(["$."]);
    expect(step(l, initialState(l), "R").moved).toBe(false);
  });
});

describe("replay and notation", () => {
  it("replays, detects the solved state and formats LURD", () => {
    const level = parseLevel(["#####", "#@$.#", "#####"]);
    const moves = fromLurd("R");
    const r = replay(level, moves);
    expect(r.firstInvalid).toBe(-1);
    expect(isSolved(level, r.states[1] ?? initialState(level))).toBe(true);
    expect(toLurd(moves, r.pushes)).toBe("R");
    expect(toLurd(fromLurd("lRu d"), [false, true, false, false])).toBe("lRud");
    expect(() => fromLurd("x")).toThrow();
  });

  it("marks the first move that does nothing", () => {
    const level = parseLevel(["#####", "#@ .#", "#####"]);
    expect(replay(level, fromLurd("rrr")).firstInvalid).toBe(2);
  });
});
