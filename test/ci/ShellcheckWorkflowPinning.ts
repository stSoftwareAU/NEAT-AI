/**
 * Issue #2695 / #3426 — every GitHub Actions `uses:` reference in
 * `.github/workflows/shellcheck.yml` must pin to a 40-character commit SHA
 * rather than a moving ref such as `@master`, `@main`, or `@vN`.
 *
 * A moving ref means any commit pushed to the upstream branch executes
 * inside our CI on the next run — a supply-chain attack vector with full
 * `GITHUB_TOKEN` blast radius. This test guards against regression by
 * scanning the workflow file directly.
 *
 * Issue #3426 removed the unmaintained `ludeeus/action-shellcheck` wrapper —
 * shellcheck now runs as the preinstalled binary via a `run:` step — so the
 * pinning guard is expressed generically over whatever actions remain (today,
 * `actions/checkout`), and a dedicated test asserts the orphaned wrapper is
 * gone.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW = join(REPO_ROOT, ".github/workflows/shellcheck.yml");

/**
 * Extract every `uses: <owner>/<repo>@<ref>` reference from a workflow.
 */
export function extractUses(
  source: string,
): { action: string; ref: string; line: number }[] {
  const refs: { action: string; ref: string; line: number }[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@(\S+)/,
    );
    if (match) {
      refs.push({ action: match[1], ref: match[2], line: i + 1 });
    }
  }
  return refs;
}

Deno.test("extractUses parses a uses line", () => {
  const src = "      - uses: foo/bar@abc123\n";
  const refs = extractUses(src);
  assertEquals(refs.length, 1);
  assertEquals(refs[0].action, "foo/bar");
  assertEquals(refs[0].ref, "abc123");
});

Deno.test("extractUses returns empty for no uses lines", () => {
  assertEquals(extractUses("name: foo\nrun: echo hi\n").length, 0);
});

Deno.test("extractUses captures multiple actions", () => {
  const src = [
    "      - uses: actions/checkout@abc",
    "      - uses: ludeeus/action-shellcheck@def",
    "",
  ].join("\n");
  const refs = extractUses(src);
  assertEquals(refs.length, 2);
  assertEquals(refs[0].action, "actions/checkout");
  assertEquals(refs[1].action, "ludeeus/action-shellcheck");
});

Deno.test(
  "shellcheck.yml pins every third-party action to a 40-char commit SHA (Issue #2695, #3426)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const refs = extractUses(source);
    assert(
      refs.length > 0,
      "expected at least one `uses:` action reference in shellcheck.yml",
    );
    for (const r of refs) {
      // Reject moving refs.
      assert(
        r.ref !== "master" && r.ref !== "main",
        `${r.action} pinned to moving ref '${r.ref}' on line ${r.line}`,
      );
      // Require a 40-character lowercase hex commit SHA.
      assertMatch(
        r.ref,
        /^[0-9a-f]{40}$/,
        `${r.action} must be pinned to a 40-char commit SHA on line ${r.line}, got '${r.ref}'`,
      );
    }
  },
);

Deno.test(
  "shellcheck.yml no longer depends on the unmaintained ludeeus/action-shellcheck wrapper (Issue #3426)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const usesLudeeus = extractUses(source).some(
      (r) => r.action === "ludeeus/action-shellcheck",
    );
    assert(
      !usesLudeeus,
      "shellcheck.yml must not `uses:` the orphaned ludeeus/action-shellcheck wrapper — run the preinstalled shellcheck binary directly instead",
    );
    // The job must still lint with the shellcheck binary at warning severity.
    assertMatch(
      source,
      /shellcheck --severity=warning/,
      "shellcheck.yml must invoke `shellcheck --severity=warning` directly",
    );
  },
);
