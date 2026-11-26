// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

/** Built-in levels. All original to this project. */

export interface LevelPreset {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
}

const rows = (text: string): string[] => text.replace(/^\n/, "").split("\n");

export const LEVEL_PRESETS: readonly LevelPreset[] = [
  {
    id: "classic",
    name: "Classic (the original default)",
    rows: ["____xxxx", "__xxx__x", "xxx_p__x", "xo__bx_x", "xoob_b_x", "xxxo_b_x", "__xxx__x", "____xxxx"],
  },
  {
    id: "warmup",
    name: "Warm-up",
    rows: rows(`
#######
#     #
# $$$ #
#.@ ..#
#     #
#######`),
  },
  {
    id: "staircase",
    name: "Staircase",
    rows: rows(`
  ######
  #    #
###$$$ #
#@ $.. #
# $... #
#    ###
######`),
  },
  {
    id: "cross",
    name: "Cross",
    rows: rows(`
#########
#   #   #
# $ . $ #
#.##@##.#
# $ . $ #
#   #   #
#########`),
  },
  {
    id: "zigzag",
    name: "Zigzag",
    rows: rows(`
 #######
 #  .  #
##$#$#.#
#  @   #
# $#.#$#
#.  .  #
########`),
  },
  {
    id: "mirror",
    name: "Mirror",
    rows: rows(`
#######
#. . .#
# $$$ #
#  @  #
# $$$ #
#. . .#
#######`),
  },
  {
    id: "courtyard",
    name: "Courtyard",
    rows: rows(`
 ########
 #   #  #
 # $  $ #
##$## # #
#  . .  #
# #.@.# #
#  $ .$ #
###  ####
  ####`),
  },
];

export const DEFAULT_PRESET = LEVEL_PRESETS[0] as LevelPreset;
