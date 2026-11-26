// SPDX-License-Identifier: GPL-3.0-only
/**
 * Vite plugin providing `virtual:third-party` (name, version, licence, purpose of every
 * direct dependency) and emitting `third-party-licenses.txt` with the full licence texts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:third-party";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

type Scope = "bundled" | "build" | "test";

export interface ThirdPartyEntry {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  purpose: string;
  scope: Scope;
  licenseText: string | null;
}

interface Manifest {
  packages: Record<string, { scope: Scope; purpose: string }>;
}

interface PkgJson {
  version?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export function directDependencies(root: string): string[] {
  const pkg = readJson(join(root, "package.json")) as PkgJson;
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].sort();
}

/** Throws if a direct dependency has no purpose or the manifest lists packages that are gone. */
export function collectThirdParty(root = process.cwd()): ThirdPartyEntry[] {
  const manifest = readJson(join(root, "third-party.json")) as Manifest;
  const deps = directDependencies(root);
  const missing = deps.filter((d) => !(d in manifest.packages));
  const stale = Object.keys(manifest.packages).filter((d) => !deps.includes(d));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `third-party.json is out of date. Missing: ${missing.join(", ") || "none"}. Not a dependency any more: ${stale.join(", ") || "none"}.`,
    );
  }
  const order: Record<Scope, number> = { bundled: 0, build: 1, test: 2 };
  return deps
    .map((name): ThirdPartyEntry => {
      const dir = join(root, "node_modules", name);
      const pkg = readJson(join(dir, "package.json")) as PkgJson;
      const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
      const homepage =
        pkg.homepage ??
        (repo
          ? repo
              .replace(/^git\+/, "")
              .replace(/^git:\/\//, "https://")
              .replace(/\.git$/, "")
          : null);
      const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
      const meta = manifest.packages[name] ?? { scope: "test" as const, purpose: "" };
      return {
        name,
        version: pkg.version ?? "?",
        license: pkg.license ?? "UNKNOWN",
        homepage,
        purpose: meta.purpose,
        scope: meta.scope,
        licenseText: licenseFile ? readFileSync(join(dir, licenseFile), "utf8").trim() : null,
      };
    })
    .sort((a, b) => order[a.scope] - order[b.scope] || a.name.localeCompare(b.name));
}

export function licensesText(entries: readonly ThirdPartyEntry[]): string {
  const sep = "=".repeat(78);
  return entries
    .map(
      (e) =>
        `${sep}\n${e.name} ${e.version} (${e.license})\n${e.homepage ?? ""}\nUsed for: ${e.purpose}\n${sep}\n\n${e.licenseText ?? "(no licence file shipped with the package)"}\n`,
    )
    .join("\n");
}

export function thirdPartyPlugin(): Plugin {
  let entries: ThirdPartyEntry[] = [];
  return {
    name: "sokoban-third-party",
    buildStart() {
      entries = collectThirdParty();
      this.addWatchFile(join(process.cwd(), "third-party.json"));
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const publicEntries = entries.map(({ licenseText: _omit, ...rest }) => rest);
      return `export default ${JSON.stringify(publicEntries)};`;
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "third-party-licenses.txt", source: licensesText(entries) });
    },
    configureServer(server) {
      server.middlewares.use("/third-party-licenses.txt", (_req, res) => {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(licensesText(collectThirdParty()));
      });
    },
  };
}
