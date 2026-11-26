// SPDX-License-Identifier: GPL-3.0-only
/** fast-check generators for random levels. */
import fc from "fast-check";
import { createEmptyLevel, type Level } from "../../src/core/level.ts";

export interface LevelShape {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxBoxes: number;
  readonly minBoxes?: number;
  readonly maxWallPercent?: number;
}

/**
 * Random small levels: random walls, n boxes, n targets (sometimes n±1), one player.
 * Not necessarily enclosed, not necessarily solvable.
 */
export function arbLevel(shape: LevelShape = { maxWidth: 7, maxHeight: 6, maxBoxes: 3 }): fc.Arbitrary<Level> {
  return fc
    .record({
      width: fc.integer({ min: 2, max: shape.maxWidth }),
      height: fc.integer({ min: 2, max: shape.maxHeight }),
    })
    .chain(({ width, height }) => {
      const size = width * height;
      return fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        wallDensity: fc.integer({ min: 0, max: shape.maxWallPercent ?? 40 }),
        order: fc.shuffledSubarray(
          Array.from({ length: size }, (_, i) => i),
          { minLength: size, maxLength: size },
        ),
        wallRoll: fc.array(fc.integer({ min: 0, max: 99 }), { minLength: size, maxLength: size }),
        boxes: fc.integer({
          min: Math.min(shape.minBoxes ?? 0, Math.floor((size - 1) / 2)),
          max: Math.min(shape.maxBoxes, Math.floor((size - 1) / 2)),
        }),
        targetDelta: fc.constantFrom(0, 0, 0, 0, 1, -1),
        overlap: fc.integer({ min: 0, max: shape.minBoxes ? 1 : 2 }),
      });
    })
    .map(({ width, height, order, wallRoll, wallDensity, boxes, targetDelta, overlap }) => {
      const level = createEmptyLevel(width, height);
      let k = 0;
      const player = order[k++] ?? 0;
      const boxCells = order.slice(k, k + boxes);
      k += boxes;
      const nTargets = Math.max(0, boxes + targetDelta);
      // Some targets sit under boxes (box already on target), the rest on free cells.
      const under = boxCells.slice(0, Math.min(overlap, nTargets));
      const free = order.slice(k, k + nTargets - under.length);
      k += free.length;
      for (const c of boxCells) level.box[c] = 1;
      for (const c of [...under, ...free]) level.target[c] = 1;
      for (const c of order.slice(k)) {
        if ((wallRoll[c] ?? 0) < wallDensity) level.wall[c] = 1;
      }
      return { ...level, player };
    });
}

/** Levels that usually need real work: 2–4 boxes, few walls. */
export const arbPuzzle = (): fc.Arbitrary<Level> =>
  arbLevel({ maxWidth: 7, maxHeight: 6, minBoxes: 2, maxBoxes: 4, maxWallPercent: 25 });
