/**
 * Package version must never go backwards relative to the PR base
 * (`origin/Develop` for the usual gate).
 *
 * A merge conflict that silently takes Develop's older `deno.json`
 * `version` (e.g. 6.3.13 over a branch that already carried 6.4.0) breaks
 * JSR consumers and confuses the auto-patch workflow. This WHAT test
 * compares the working-tree version to `origin/Develop` when that ref is
 * available and fails if the working tree is strictly older.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Parse a plain `MAJOR.MINOR.PATCH` token into numeric parts. */
export function parsePackageSemver(
  version: string,
): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two plain semver tokens.
 *
 * @returns negative when `a < b`, zero when equal, positive when `a > b`
 */
export function comparePackageSemver(a: string, b: string): number {
  const pa = parsePackageSemver(a);
  const pb = parsePackageSemver(b);
  assert(pa !== null, `invalid package semver: ${a}`);
  assert(pb !== null, `invalid package semver: ${b}`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function readWorkingTreeVersion(): string {
  const json = JSON.parse(
    Deno.readTextFileSync(join(REPO_ROOT, "deno.json")),
  ) as { version?: string };
  assertEquals(typeof json.version, "string");
  return json.version as string;
}

function readOriginDevelopVersion(): string | null {
  try {
    const proc = new Deno.Command("git", {
      args: ["show", "origin/Develop:deno.json"],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (!proc.success) return null;
    const json = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
      version?: string;
    };
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  }
}

Deno.test("parsePackageSemver accepts plain MAJOR.MINOR.PATCH only", () => {
  assertEquals(parsePackageSemver("6.5.0"), [6, 5, 0]);
  assertEquals(parsePackageSemver(" 1.2.3 "), [1, 2, 3]);
  assertEquals(parsePackageSemver("6.5.0-beta"), null);
  assertEquals(parsePackageSemver("not-a-version"), null);
});

Deno.test("comparePackageSemver orders major/minor/patch", () => {
  assert(comparePackageSemver("6.5.0", "6.4.0") > 0);
  assert(comparePackageSemver("6.3.13", "6.4.0") < 0);
  assertEquals(comparePackageSemver("6.5.0", "6.5.0"), 0);
});

Deno.test({
  name: "deno.json version must not be behind origin/Develop",
  ignore: readOriginDevelopVersion() === null,
  fn: () => {
    const current = readWorkingTreeVersion();
    const develop = readOriginDevelopVersion();
    assert(develop !== null);
    assert(
      comparePackageSemver(current, develop) >= 0,
      `deno.json version ${current} is behind origin/Develop ${develop}. ` +
        `Package versions must never go backwards — bump (e.g. after a ` +
        `merge conflict) instead of taking the older Develop token.`,
    );
  },
});
