// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/** Colour themes: CSS custom properties per [data-theme], choice kept in localStorage. */

import { el } from "./dom.ts";

export const THEMES = [
  { id: "classic", name: "Classic" },
  { id: "night", name: "Night" },
  { id: "paper", name: "Paper" },
  { id: "contrast", name: "High contrast" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "sokoban-solver:theme";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** Saved theme, else the system preference (night for dark mode), else classic. */
export function initialTheme(): ThemeId {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, sandboxed iframe); fall through.
  }
  if (isThemeId(saved)) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "classic";
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset["theme"] = id;
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Not fatal: the theme just will not survive a reload.
  }
}

export interface Palette {
  readonly page: string;
  readonly ink: string;
  readonly wall: string;
  readonly floor: string;
  readonly grid: string;
  readonly player: string;
  readonly box: string;
  readonly target: string;
  readonly path: string;
  readonly dead: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string): string => css.getPropertyValue(`--${name}`).trim();
  return {
    page: v("page"),
    ink: v("ink"),
    wall: v("wall"),
    floor: v("floor"),
    grid: v("grid"),
    player: v("player"),
    box: v("box"),
    target: v("target"),
    path: v("path"),
    dead: v("dead"),
  };
}

/** Radio swatches; each previews its theme's colours via a nested data-theme. */
export function mountThemePicker(container: HTMLElement, current: ThemeId, onChange: (id: ThemeId) => void): void {
  for (const theme of THEMES) {
    const input = el("input", {
      attrs: { type: "radio", name: "theme", value: theme.id, "aria-label": `${theme.name} theme` },
    });
    input.checked = theme.id === current;
    input.addEventListener("change", () => {
      if (input.checked) onChange(theme.id);
    });
    const grid = el("span", { className: "chip-grid", attrs: { "data-theme": theme.id } }, [
      el("span", { attrs: { style: "background: var(--wall)" } }),
      el("span", { attrs: { style: "background: var(--floor)" } }),
      el("span", { attrs: { style: "background: var(--box)" } }),
      el("span", { attrs: { style: "background: var(--target)" } }),
    ]);
    const chips = el("span", { className: "chips", attrs: { "aria-hidden": "true" } }, [grid]);
    container.append(el("label", { className: "theme-swatch", attrs: { title: theme.name } }, [input, chips]));
  }
}
