// SPDX-License-Identifier: GPL-3.0-only
// Copyright spezifisch <spezifisch+git@gmail.com>

/** About dialog: contact, build provenance, licence, source and third-party licences. */

import buildInfo from "virtual:build-info";
import thirdParty, { type ThirdPartyPackage } from "virtual:third-party";
import { el } from "./dom.ts";

function link(href: string, text: string): HTMLAnchorElement {
  return el("a", { text, attrs: { href, target: "_blank", rel: "noopener" } });
}

function kv(rows: [string, Node | string][]): HTMLDListElement {
  const dl = el("dl", { className: "kv" });
  for (const [k, v] of rows) dl.append(el("dt", { text: k }), el("dd", {}, [v]));
  return dl;
}

function section(title: string, ...body: Node[]): HTMLElement {
  return el("section", { className: "about-section" }, [el("h3", { text: title }), ...body]);
}

const SCOPE_TITLE: Record<ThirdPartyPackage["scope"], string> = {
  bundled: "Shipped in this page",
  build: "Used to build the page",
  test: "Used to test the code",
};

function dependencyList(): Node[] {
  const out: Node[] = [];
  const bundled = thirdParty.filter((p) => p.scope === "bundled");
  if (bundled.length === 0) {
    out.push(
      el("p", {
        className: "hint",
        text: "No third-party libraries run in this page: the solver, the board and the UI are this project's own code. The tools below are only used to build and test it.",
      }),
    );
  }
  for (const scope of ["bundled", "build", "test"] as const) {
    const items = thirdParty.filter((p) => p.scope === scope);
    if (items.length === 0) continue;
    out.push(el("p", { className: "deps-group", text: SCOPE_TITLE[scope] }));
    out.push(
      el(
        "ul",
        { className: "deps" },
        items.map((p) =>
          el("li", {}, [
            el("span", {}, [p.homepage ? link(p.homepage, p.name) : el("span", { text: p.name }), ` ${p.version}`]),
            el("span", { className: "dep-license", text: p.license }),
            el("span", { className: "dep-purpose", text: p.purpose }),
          ]),
        ),
      ),
    );
  }
  out.push(el("p", { className: "hint" }, [link("./third-party-licenses.txt", "Full licence texts")]));
  return out;
}

export function renderAbout(container: HTMLElement): void {
  const { author } = buildInfo;
  const shortSha = buildInfo.commit.slice(0, 7);
  const commit = buildInfo.commitUrl ? link(buildInfo.commitUrl, shortSha) : el("span", { text: shortSha });
  const ci = buildInfo.ci
    ? link(buildInfo.ci.url, `${buildInfo.ci.workflow || "CI"} run #${buildInfo.ci.runNumber}`)
    : el("span", { text: "Local build (not built in CI)" });

  container.replaceChildren(
    el("p", {
      text: `Sokoban Solver ${buildInfo.version}. Draw a level, let the browser find the solution with the fewest moves, and watch it.`,
    }),
    section(
      "Contact",
      kv([
        [
          "Author",
          author.email
            ? el("span", {}, [`${author.name} · `, link(`mailto:${author.email}`, author.email)])
            : author.name,
        ],
        ["Issues", link(buildInfo.issuesUrl, "Report a bug or ask a question")],
      ]),
    ),
    section(
      "This build",
      kv([
        ["Commit", buildInfo.dirty ? el("span", {}, [commit, " (with local changes)"]) : commit],
        ["Branch", buildInfo.branch],
        ["CI", ci],
        ["Built", new Date(buildInfo.builtAt).toLocaleString()],
      ]),
    ),
    section(
      "Licence and source",
      kv([
        ["Licence", link(buildInfo.licenseUrl, buildInfo.license)],
        ["Source", link(buildInfo.repoUrl, buildInfo.repoUrl.replace(/^https:\/\//, ""))],
      ]),
    ),
    section("Third-party software", ...dependencyList()),
  );
}

/** Wires open/close: close buttons, Escape (native) and a click on the backdrop. */
export function setupAboutDialog(dialog: HTMLDialogElement, openers: HTMLElement[], content: HTMLElement): void {
  let rendered = false;
  for (const opener of openers) {
    opener.addEventListener("click", () => {
      if (!rendered) {
        renderAbout(content);
        rendered = true;
      }
      dialog.showModal();
    });
  }
  for (const btn of dialog.querySelectorAll<HTMLElement>("[data-close]")) {
    btn.addEventListener("click", () => {
      dialog.close();
    });
  }
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) dialog.close();
  });
}
