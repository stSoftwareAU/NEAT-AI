/**
 * Issue #2695 — `.github/workflows/shellcheck.yml` must pin
 * `ludeeus/action-shellcheck` to a 40-character commit SHA rather than a
 * moving ref such as `@master`, `@main`, or `@vN`.
 *
 * A moving ref means any commit pushed to the upstream branch executes
 * inside our CI on the next run — a supply-chain attack vector with full
 * `GITHUB_TOKEN` blast radius. This test guards against regression by
 * scanning the workflow file directly.
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
  "shellcheck.yml pins ludeeus/action-shellcheck to a 40-char commit SHA (Issue #2695)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const refs = extractUses(source).filter(
      (r) => r.action === "ludeeus/action-shellcheck",
    );
    assert(
      refs.length > 0,
      "expected at least one ludeeus/action-shellcheck reference in shellcheck.yml",
    );
    for (const r of refs) {
      // Reject moving refs.
      assert(
        r.ref !== "master" && r.ref !== "main",
        `ludeeus/action-shellcheck pinned to moving ref '${r.ref}' on line ${r.line}`,
      );
      // Require a 40-character lowercase hex commit SHA.
      assertMatch(
        r.ref,
        /^[0-9a-f]{40}$/,
        `ludeeus/action-shellcheck must be pinned to a 40-char commit SHA on line ${r.line}, got '${r.ref}'`,
      );
    }
  },
);

Deno.test(
  "shellcheck.yml records the resolved tag in a comment for reviewer provenance (Issue #2695)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    // A nearby comment naming the action and its tag lets reviewers verify
    // the SHA resolves to a real release.
    assertMatch(
      source,
      /#\s*ludeeus\/action-shellcheck@\S+/,
      "expected a '# ludeeus/action-shellcheck@<tag>' comment near the pinned SHA",
    );
  },
);
