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
pnpm bench          # solver timings for the built-in levels
```

Layout: `src/core/` holds the level model, game rules and solver (no DOM), `src/ui/` the page, `src/solver.worker.ts` the worker, `build/` the Vite plugins for build info and third-party licences.

Every direct dependency needs an entry in [`third-party.json`](third-party.json) saying what it is used for; the build and the unit tests fail otherwise.

## CI and deployment

Commits go straight to `main`. [The CI workflow](.github/workflows/ci.yml) runs lint, unit tests, fuzz tests, a soak test and the browser tests in parallel. Only when all of them pass does the build job produce the site and its screenshots, and only then does the last job deploy it to GitHub Pages. A weekly scheduled run fuzzes and soaks for much longer. Dependabot keeps npm packages and GitHub Actions up to date.

## Licence

[GPL-3.0-only](LICENSE). Copyright Fiona.
