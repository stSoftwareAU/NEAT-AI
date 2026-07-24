/**
 * Issue #2695 / #3426 — supply-chain hygiene for
 * `.github/workflows/shellcheck.yml`.
 *
 * Issue #3426 dropped the unmaintained `ludeeus/action-shellcheck` wrapper
 * (no release in ~42 months) and now lints via the koalaman/shellcheck binary
 * preinstalled on the runner, invoked directly from a `run:` step. This
 * removes the orphaned third-party Action from the supply chain entirely.
 *
 * These tests guard that:
 *   - the unmaintained wrapper does not creep back in, and
 *   - every remaining `uses:` reference stays pinned to a 40-character commit
 *     SHA (Issue #2695) — a moving ref means any commit pushed to the upstream
 *     branch executes inside our CI with full `GITHUB_TOKEN` blast radius.
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
    "      - uses: actions/setup-node@def",
    "",
  ].join("\n");
  const refs = extractUses(src);
  assertEquals(refs.length, 2);
  assertEquals(refs[0].action, "actions/checkout");
  assertEquals(refs[1].action, "actions/setup-node");
});

Deno.test(
  "shellcheck.yml no longer uses the unmaintained ludeeus/action-shellcheck (Issue #3426)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const refs = extractUses(source).filter(
      (r) => r.action === "ludeeus/action-shellcheck",
    );
    assertEquals(
      refs.length,
      0,
      "shellcheck.yml must not reference the orphaned ludeeus/action-shellcheck wrapper",
    );
    assert(
      !source.includes("ludeeus/action-shellcheck"),
      "shellcheck.yml must not mention ludeeus/action-shellcheck anywhere (Issue #3426)",
    );
  },
);

Deno.test(
  "shellcheck.yml lints via the preinstalled koalaman/shellcheck binary (Issue #3426)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    // The gate must invoke the binary directly at warning severity rather than
    // through a third-party wrapper Action.
    assertMatch(
      source,
      /shellcheck\s+--severity=warning/,
      "shellcheck.yml must run 'shellcheck --severity=warning' directly",
    );
    // The upstream project reference lets the workflow-sync detector recognise
    // the lint gate (Issue #2430).
    assert(
      source.includes("koalaman/shellcheck"),
      "shellcheck.yml must reference the upstream koalaman/shellcheck project",
    );
  },
);

Deno.test(
  "every remaining uses: in shellcheck.yml is pinned to a 40-char commit SHA (Issue #2695)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const refs = extractUses(source);
    assert(
      refs.length > 0,
      "expected at least one pinned action (e.g. actions/checkout) in shellcheck.yml",
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
