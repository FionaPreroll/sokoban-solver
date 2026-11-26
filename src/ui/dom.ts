// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/** Typed element lookup: fails loudly if the markup and the code disagree. */
export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) {
    throw new Error(`#${id} is missing or not a ${type.name}`);
  }
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

export function fmtMs(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isSmallScreen(): boolean {
  return window.matchMedia("(max-width: 760px)").matches;
}
