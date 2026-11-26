// SPDX-License-Identifier: GPL-3.0-only
/** Vite plugin providing `virtual:build-info` (commit, branch, CI run, licence, contact). */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { BuildInfo } from "virtual:build-info";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:build-info";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

interface PackageJson {
  version: string;
  license: string;
  author: string;
  repository: { url: string };
  bugs: { url: string };
}

export function parseAuthor(author: string): { name: string; email: string | null } {
  const m = /^\s*([^<]+?)\s*(?:<([^>]+)>)?\s*$/.exec(author);
  return { name: m?.[1] ?? author, email: m?.[2] ?? null };
}

export function collectBuildInfo(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): BuildInfo {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as PackageJson;
  const server = env["GITHUB_SERVER_URL"] ?? "https://github.com";
  const repoSlug = env["GITHUB_REPOSITORY"];
  const repoUrl = repoSlug ? `${server}/${repoSlug}` : pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  const inCi = env["GITHUB_ACTIONS"] === "true" && env["GITHUB_RUN_ID"] !== undefined;
  const commit = env["GITHUB_SHA"] ?? git(["rev-parse", "HEAD"]) ?? "unknown";
  // On pull requests GITHUB_REF_NAME is "123/merge"; the head branch is more useful.
  // `||` on purpose: GitHub sets GITHUB_HEAD_REF to "" outside pull requests.
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  const branch =
    env["GITHUB_HEAD_REF"] || env["GITHUB_REF_NAME"] || git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  const dirty = !inCi && (git(["status", "--porcelain"]) ?? "") !== "";
  return {
    version: pkg.version,
    commit,
    commitUrl: commit === "unknown" ? null : `${repoUrl}/commit/${commit}`,
    branch,
    dirty,
    builtAt: new Date().toISOString(),
    ci: inCi
      ? {
          provider: "GitHub Actions" as const,
          workflow: env["GITHUB_WORKFLOW"] ?? "",
          runId: env["GITHUB_RUN_ID"] ?? "",
          runNumber: env["GITHUB_RUN_NUMBER"] ?? "",
          runAttempt: env["GITHUB_RUN_ATTEMPT"] ?? "1",
          url: `${repoUrl}/actions/runs/${env["GITHUB_RUN_ID"] ?? ""}`,
        }
      : null,
    repoUrl,
    license: pkg.license,
    licenseUrl: `${repoUrl}/blob/main/LICENSE`,
    author: parseAuthor(pkg.author),
    issuesUrl: pkg.bugs.url,
  };
}

export function buildInfoPlugin(): Plugin {
  return {
    name: "sokoban-build-info",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export default ${JSON.stringify(collectBuildInfo())};`;
    },
  };
}
