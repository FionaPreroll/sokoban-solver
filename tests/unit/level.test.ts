// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  LevelParseError,
  paintCell,
  parseLevel,
  resizeLevel,
  serializeLevel,
  validateLevel,
} from "../../src/core/level.ts";
import { LEVEL_PRESETS } from "../../src/core/levels.ts";

describe("parseLevel", () => {
  it("reads the legacy notation of the original tool", () => {
    const level = parseLevel(["xxxx", "xpbo", "xxxx"]);
    expect(serializeLevel(level)).toEqual(["####", "#@$.", "####"]);
  });

  it("reads XSB including box/player on target", () => {
    const level = parseLevel("#####\n#+*.#\n#####\n");
    expect(level.player).toBe(6);
    expect(level.target[6]).toBe(1);
    expect(level.box[7]).toBe(1);
    expect(level.target[7]).toBe(1);
    expect(serializeLevel(level)).toEqual(["#####", "#+*.#", "#####"]);
  });

  it("pads ragged rows and trims blank lines", () => {
    const level = parseLevel("\n\n###\n#@\n###\n\n");
    expect(serializeLevel(level)).toEqual(["###", "#@ ", "###"]);
    expect(level.width).toBe(3);
    expect(level.height).toBe(3);
  });

  it("rejects unknown characters with position", () => {
    expect(() => parseLevel(["###", "#?#"])).toThrow(LevelParseError);
    try {
      parseLevel(["###", "#?#"]);
    } catch (e) {
      expect(e).toMatchObject({ line: 2, column: 2 });
    }
  });

  it("rejects two players", () => {
    expect(() => parseLevel(["@@"])).toThrow(/More than one player/);
  });

  it("rejects empty input and oversized levels", () => {
    expect(() => parseLevel("   \n")).toThrow(/empty/);
    expect(() => parseLevel("#".repeat(65))).toThrow(/larger/);
  });

  it("round-trips all presets", () => {
    for (const preset of LEVEL_PRESETS) {
      const level = parseLevel(preset.rows);
      expect(parseLevel(serializeLevel(level))).toEqual(level);
    }
  });
});

describe("validateLevel", () => {
  it("reports missing player and box/target mismatch", () => {
    expect(validateLevel(parseLevel(["$.."])).map((i) => i.kind)).toEqual(["no-player", "box-target-mismatch"]);
    expect(validateLevel(parseLevel(["@$$."])).map((i) => i.kind)).toEqual(["too-many-boxes"]);
    expect(validateLevel(parseLevel(["@"])).map((i) => i.kind)).toEqual(["no-boxes"]);
    expect(validateLevel(parseLevel(["@$."]))).toEqual([]);
  });
});

describe("editing", () => {
  const base = parseLevel(["#####", "#@$.#", "#####"]);

  it("keeps targets under boxes and the player (legacy bug: target was lost)", () => {
    const withBox = paintCell(base, 8, "box");
    expect(serializeLevel(withBox)[1]).toBe("#@$*#");
    const withPlayer = paintCell(base, 8, "player");
    expect(serializeLevel(withPlayer)[1]).toBe("# $+#");
  });

  it("has exactly one player after placing one", () => {
    const moved = paintCell(base, 7, "player");
    expect(serializeLevel(moved)[1]).toBe("# @.#");
  });

  it("does not mutate the input level", () => {
    const before = serializeLevel(base);
    paintCell(base, 6, "wall");
    expect(serializeLevel(base)).toEqual(before);
  });

  it("ignores out-of-range cells", () => {
    expect(paintCell(base, 99, "wall")).toBe(base);
  });

  it("resizes anchored at the top-left", () => {
    const small = resizeLevel(base, 3, 2);
    expect(serializeLevel(small)).toEqual(["###", "#@$"]);
    const big = resizeLevel(base, 6, 4);
    expect(serializeLevel(big)).toEqual(["##### ", "#@$.# ", "##### ", "      "]);
    expect(resizeLevel(base, 2, 1).player).toBe(-1);
  });
});
