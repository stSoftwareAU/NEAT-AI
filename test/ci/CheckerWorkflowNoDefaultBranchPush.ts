import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies that test/lint/scan (checker) workflows do NOT trigger on `push:`
 * to the default branch `Develop` (Issue #3348 — finding
 * `BP-TRIGGER-markdown-lint`).
 *
 * A checker workflow gates the pull request. Once it is a required status
 * check, letting it also fire on `push: Develop` re-runs it on every merge
 * into the default branch — a duplicate of the run that already gated the PR.
 * The post-merge run wastes CI minutes and can leave a red tick on the
 * default branch for a check that already passed on the PR.
 *
 * Deploy/publish/release workflows are deliberately excluded: they MUST keep
 * firing on `push: Develop` to release from the default branch. This test only
 * constrains checkers.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting trigger configuration, not on how the value is written.
 */

interface PushTrigger {
  branches?: string[];
}

interface OnBlock {
  push?: PushTrigger | null;
}

interface Workflow {
  on?: OnBlock;
}

const WORKFLOW_DIR = ".github/workflows";
const DEFAULT_BRANCH = "Develop";

// Test/lint/scan workflows that gate the PR. None of these should re-run on a
// push to the default branch.
const CHECKER_WORKFLOWS = [
  "markdown-lint.yml",
];

async function readWorkflow(name: string): Promise<Workflow> {
  const text = await Deno.readTextFile(`${WORKFLOW_DIR}/${name}`);
  return parse(text) as Workflow;
}

for (const name of CHECKER_WORKFLOWS) {
  Deno.test(
    `${name} does not trigger on push to the default branch ${DEFAULT_BRANCH} (Issue #3348)`,
    async () => {
      const wf = await readWorkflow(name);
      const push = wf.on?.push;

      // No push trigger at all is fine — the checker gates the PR only.
      if (push === undefined || push === null) return;

      const branches = push.branches;
      assert(
        Array.isArray(branches),
        `${name}: push trigger must declare an explicit branches filter so it ` +
          `cannot reach the default branch ${DEFAULT_BRANCH}; got: ${
            JSON.stringify(branches)
          }`,
      );

      assert(
        !branches.includes(DEFAULT_BRANCH),
        `${name}: checker workflow must not run on push to the default branch ` +
          `${DEFAULT_BRANCH} — it already gated the PR. Drop ${DEFAULT_BRANCH} ` +
          `from the push.branches filter. Got: ${JSON.stringify(branches)}`,
      );

      // A bare "*" glob matches the default branch too.
      assert(
        !branches.includes("*") && !branches.includes("**"),
        `${name}: push.branches must not use a catch-all glob (${
          JSON.stringify(branches)
        }) ` +
          `that also matches the default branch ${DEFAULT_BRANCH}`,
      );
    },
  );
}
