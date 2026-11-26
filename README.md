# Sokoban Solver

Draw a Sokoban level, let the browser find the solution with the **fewest possible moves**, and watch it step by step.

**[Open the app](https://fionapreroll.github.io/sokoban-solver/)** · [Screenshots](https://fionapreroll.github.io/sokoban-solver/screenshots/) · [Changelog](CHANGELOG.md)

[![Desktop, Classic theme](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-classic.png)](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-classic.png)

| Night                                                                                                                                                                      | Paper                                                                                                                                                                      | High contrast                                                                                                                                                                            | Mobile                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Night theme](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-night.png)](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-night.png) | [![Paper theme](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-paper.png)](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-paper.png) | [![High contrast theme](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-contrast.png)](https://fionapreroll.github.io/sokoban-solver/screenshots/desktop-contrast.png) | [![Mobile after solving](https://fionapreroll.github.io/sokoban-solver/screenshots/mobile-solved.png)](https://fionapreroll.github.io/sokoban-solver/screenshots/mobile-solved.png) |

The screenshots are taken by CI from the deployed build on every push to `main`; they are not stored in the repository.

## Using it

1. **Pick or draw a level.** Choose a built-in level, or select a tile (wall, floor, player, box, target) and tap or drag on the board. Levels can also be pasted as text in [XSB notation](http://www.sokobano.de/wiki/index.php?title=Level_format) (`#` wall, `@` player, `$` box, `.` target, `*` box on target, `+` player on target); the old `x _ p b o` notation still works.
2. **Solve.** The search runs in the background and can be stopped at any time.
3. **Watch the solution.** Play, pause, step, or drag the slider. The moves are shown in LURD notation (upper case = push).
4. **Layers.** Show the player's whole route or the dead squares (cells from which a box can never reach a target).

The colour theme (top right) is remembered in the browser. **About** shows the exact commit, branch and CI run of the build you are looking at, the licence, and every third-party package with its licence and purpose.

## How the solver works

It is a breadth-first search over (player position, box positions), so the first solution found has the minimum number of moves, exactly like the original version. It is faster because of how the search is done, not because it settles for longer solutions:

- the board is padded with walls, so there are no bounds checks in the inner loop;
- a state is a short string of cell indices (player plus sorted boxes);
- the queue is an index into the node list, and paths are parent pointers instead of copied arrays;
- boxes are never pushed onto dead squares, and pushes that build a 2×2 block of walls and boxes with a box off target are cut.

Both prunings only remove states that cannot lead to a solution, so solution lengths are unchanged. The fuzz tests check this against a deliberately naive reference solver on random levels.

## Performance, before and after

Measured on 2026-11-26 against the **unmodified original code** (kept in [`legacy/`](legacy/)); both find solutions of the same length.

**In the browser** (Chromium, from clicking the solve button to the result being shown; `pnpm bench:browser`). The original page also paused for a timer every 100 states, which is included here because users paid for it:

| Level     | Moves | Before (original page) |  After | Speed-up |
| --------- | ----: | ---------------------: | -----: | -------: |
| classic   |    53 |                  3.0 s |  64 ms |      47× |
| warmup    |    18 |                 708 ms |  64 ms |      11× |
| staircase |    34 |                 87.2 s |  61 ms |   1,430× |
| cross     |    38 |                  3.7 s | 114 ms |      32× |
| zigzag    |    55 |                  4.2 s | 114 ms |      37× |
| mirror    |    21 |              > 2 min ¹ | 321 ms |   > 370× |
| courtyard |   105 |              > 2 min ¹ | 323 ms |   > 370× |

¹ Stopped after 120 s.

**Solver core only** (Node 22, `pnpm bench`). Here the original's timer pauses are removed, so this compares the pure algorithms. Median of 7 runs for the new solver, one run for the original:

| Level     | Moves |  Before |  After | Speed-up | States searched, before → after |
| --------- | ----: | ------: | -----: | -------: | ------------------------------: |
| classic   |    53 |  656 ms | 2.2 ms |     302× |                  57,995 → 1,758 |
| warmup    |    18 |  158 ms | 1.2 ms |     133× |                  13,554 → 1,113 |
| staircase |    34 |  66.0 s | 2.9 ms |  23,107× |                 567,493 → 6,517 |
| cross     |    38 |  921 ms |  11 ms |      85× |                 71,752 → 18,625 |
| zigzag    |    55 |   1.1 s |  12 ms |      92× |                 83,924 → 20,037 |
| mirror    |    21 | 155.5 s | 263 ms |     591× |               553,902 → 224,301 |
| courtyard |   105 | 632.0 s | 173 ms |   3,655× |             4,161,740 → 254,960 |

The original also needed about 1.5 GB of memory for "courtyard". The CI build job runs the core benchmark on every push and writes the table into the run's summary.

## Development

Requires Node.js 22.18 or newer and pnpm (`corepack enable` picks the version from `package.json`).

```sh
pnpm install
pnpm dev            # dev server
pnpm build          # production build in dist/
pnpm lint           # tsc --noEmit, ESLint, Prettier
pnpm test           # unit tests
pnpm test:fuzz      # property-based fuzz tests (FUZZ_RUNS=…, FUZZ_SEED=… to reproduce)
pnpm test:soak      # soak test (SOAK_SECONDS=…)
pnpm test:e2e       # Playwright browser tests (desktop and mobile), needs a build
pnpm screenshots    # showcase screenshots of dist/ into dist/screenshots/
pnpm bench          # core benchmark against the unmodified legacy code
pnpm bench:browser  # click-to-result benchmark in Chromium, needs a build
```

Layout: `src/core/` holds the level model, game rules and solver (no DOM), `src/ui/` the page, `src/solver.worker.ts` the worker, `build/` the Vite plugins for build info and third-party licences, `legacy/` the original version for the benchmark.

Every direct dependency needs an entry in [`third-party.json`](third-party.json) saying what it is used for; the build and the unit tests fail otherwise.

## CI and deployment

Commits go straight to `main`. [The CI workflow](.github/workflows/ci.yml) runs lint, unit tests, fuzz tests, a soak test and the browser tests in parallel. Only when all of them pass does the build job produce the site and its screenshots, and only then does the last job deploy it to GitHub Pages. A weekly scheduled run fuzzes and soaks for much longer. Dependabot keeps npm packages and GitHub Actions up to date.

## Licence

[GPL-3.0-only](LICENSE). Copyright spezifisch.
