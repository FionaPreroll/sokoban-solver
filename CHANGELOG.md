# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-11-26

Complete rewrite in strict TypeScript. The look of the original page is kept: serif
type, a plain board in a thin frame, flat square controls and the five tile colours.

### Added

- Solver runs in a Web Worker: the page stays responsive and **Stop** is instant.
- Solver statistics: states searched, search depth, time, number of pushes.
- Built-in levels (all original) and a level text box that reads XSB and the old `x _ p b o` notation.
- Boxes and the player can stand on targets (`*` and `+`).
- Level size can be changed; edits can be undone; the level is kept across reloads.
- Playback: step back, scrubber, solution in LURD notation with the current move highlighted, copy button,
  keyboard shortcuts (Space, ←, →).
- Layers: solution path (from the start, finished part faded) and dead squares.
- Colour themes (Classic, Night, Paper, High contrast), remembered in the browser.
- About dialog with contact, commit, branch, CI run, licence, source link and all third-party
  packages with licence and purpose; full licence texts are deployed as `third-party-licenses.txt`.
- Mobile layout: the board stays on top, the numbered steps follow in working order, and a found
  solution is highlighted and scrolled next to the playback controls.
- Tooling: pnpm, Vite, ESLint (type-aware), Prettier, Vitest unit tests, fast-check fuzz tests against
  a naive reference solver, a soak test, Playwright browser tests.
- GitHub Actions CI; GitHub Pages deploy as the last job after all checks pass; screenshots generated
  and deployed by CI; Dependabot for npm and GitHub Actions.
- Benchmarks: `pnpm bench` (core, against the unmodified legacy code) and `pnpm bench:browser`.

### Changed

- Solver core: same move-optimal breadth-first search, but with compact state keys, an index queue,
  parent pointers instead of copied paths, and pruning of dead squares and 2×2 freeze deadlocks.
  Results are identical in length (checked by fuzz tests); speed-ups range from 11× (small levels, in the browser) to over 20,000×
  (core, one level); see README.
- Cells outside the grid count as walls, so levels no longer have to be fully enclosed.
- The canvas scales to the screen and renders sharply on high-DPI displays.

### Removed

- The "..with Debug" button (its console output is replaced by on-page statistics).
- The Makefile, which depended on a `../Makefile.base` outside the repository.

### Fixed

- **Next Step** threw an error on the last move (it referenced a non-existent `stopAnimation` element).
- The **Frame Rate** input was ignored; playback always ran at 10 moves per second.
- After editing the map, the solver still checked the goal against the original level.
- After playback or reset, the editor painted into a stale copy of the grid.
- Painting a box or the player onto a target erased the target.
- Hiding the player layer filled the player's cell with solid blue instead of showing the floor.
- The solution-path layer started at the current position instead of the start, so it was wrong
  after the first step.
- Levels without walls at the edge raised "out of bounds" errors (and the box variant of the message
  printed the wrong coordinates).
- Starting a new search while one was running ran both at once on shared state.
- **Stop Solving** threw away the previous solution and reported "No solution found".
- An already solved level reported "No solution found".
- On load the page showed a hard-coded 61-move solution; the shortest solution is 53 moves.
- Clicks on a scaled canvas hit the wrong cell.

## [1.0.0] - 2024-08-28

First version (single HTML page with a breadth-first solver and map editor; not tagged).

### Added

- Sokoban solver page with map editor.
- `addlicense` Makefile target.

### Fixed

- Lint fixes.

[Unreleased]: https://github.com/FionaPreroll/sokoban-solver/commits/main
[2.0.0]: https://github.com/FionaPreroll/sokoban-solver/tree/main
[1.0.0]: https://github.com/FionaPreroll/sokoban-solver/commit/9c43d0e
