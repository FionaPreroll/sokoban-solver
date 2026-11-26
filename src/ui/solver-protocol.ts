// SPDX-License-Identifier: GPL-3.0-only
// Copyright Fiona <fipreroll+app@gmail.com>

import type { Level } from "../core/level.ts";
import type { SolveProgress, SolveResult } from "../core/solver.ts";

export interface SolveRequest {
  readonly type: "solve";
  readonly level: Level;
  readonly maxStates: number;
}

export type SolveResponse =
  | ({ readonly type: "progress" } & SolveProgress)
  | { readonly type: "result"; readonly result: SolveResult }
  | { readonly type: "error"; readonly message: string };
