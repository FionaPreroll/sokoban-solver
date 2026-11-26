// SPDX-License-Identifier: GPL-3.0-only

declare module "virtual:build-info" {
  export interface CiRun {
    readonly provider: "GitHub Actions";
    readonly workflow: string;
    readonly runId: string;
    readonly runNumber: string;
    readonly runAttempt: string;
    readonly url: string;
  }
  export interface BuildInfo {
    readonly version: string;
    readonly commit: string;
    readonly commitUrl: string | null;
    readonly branch: string;
    readonly dirty: boolean;
    readonly builtAt: string;
    readonly ci: CiRun | null;
    readonly repoUrl: string;
    readonly license: string;
    readonly licenseUrl: string;
    readonly author: { readonly name: string; readonly email: string | null };
    readonly issuesUrl: string;
  }
  const info: BuildInfo;
  export default info;
}

declare module "virtual:third-party" {
  export interface ThirdPartyPackage {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly homepage: string | null;
    readonly purpose: string;
    readonly scope: "bundled" | "build" | "test";
  }
  const packages: readonly ThirdPartyPackage[];
  export default packages;
}
