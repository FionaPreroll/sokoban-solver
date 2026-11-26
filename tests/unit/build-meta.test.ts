// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import { collectBuildInfo, parseAuthor } from "../../build/build-info.ts";
import { collectThirdParty, directDependencies, licensesText } from "../../build/third-party.ts";

describe("third-party manifest", () => {
  it("documents every direct dependency with a purpose and a licence", () => {
    const entries = collectThirdParty();
    expect(entries.map((e) => e.name).sort()).toEqual(directDependencies(process.cwd()));
    for (const e of entries) {
      expect(e.purpose.length, e.name).toBeGreaterThan(5);
      expect(e.license, e.name).not.toBe("UNKNOWN");
    }
    expect(licensesText(entries)).toContain("Used for:");
  });
});

describe("build info", () => {
  it("uses GitHub Actions variables when present", () => {
    const info = collectBuildInfo({
      GITHUB_ACTIONS: "true",
      GITHUB_RUN_ID: "42",
      GITHUB_RUN_NUMBER: "7",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_WORKFLOW: "CI",
      GITHUB_SHA: "abc123",
      GITHUB_REF_NAME: "main",
      GITHUB_REPOSITORY: "someone/sokoban-solver",
      GITHUB_SERVER_URL: "https://github.com",
    });
    expect(info).toMatchObject({
      commit: "abc123",
      branch: "main",
      dirty: false,
      commitUrl: "https://github.com/someone/sokoban-solver/commit/abc123",
      ci: { runNumber: "7", url: "https://github.com/someone/sokoban-solver/actions/runs/42" },
    });
  });

  it("has no CI run for local builds", () => {
    expect(collectBuildInfo({}).ci).toBeNull();
  });

  it("parses the author field", () => {
    expect(parseAuthor("A B <a@b.c>")).toEqual({ name: "A B", email: "a@b.c" });
    expect(parseAuthor("Solo")).toEqual({ name: "Solo", email: null });
  });
});
