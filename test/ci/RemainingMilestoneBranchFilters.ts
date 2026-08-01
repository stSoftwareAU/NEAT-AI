import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies the four remaining PR quality gates run on milestone feature-branch
 * PRs, not just PRs into `Develop` (Issue #3606).
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch (planning
 * delivery workflow). While five sibling workflows were fixed earlier (Issues
 * #3359–#3363), shellcheck, spellcheck, dependency-review and bench were
 * missed, so those gates never ran on milestone PRs. Adding the single-level
 * `milestone/*` glob (milestone names have no nested slashes) restores them.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting `pull_request.branches` filter, not on how it is written.
 */

interface PullRequestTrigger {
  branches?: string[];
}

interface Workflow {
  on?: { "pull_request"?: PullRequestTrigger };
}

const WORKFLOWS = [
  ".github/workflows/shellcheck.yml",
  ".github/workflows/spellcheck.yaml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/bench.yaml",
];

async function readBranches(path: string): Promise<string[] | undefined> {
  const text = await Deno.readTextFile(path);
  // `@std/yaml` keeps `on` as the string key "on" (it is not coerced to the
  // YAML 1.1 boolean `true`), so `wf.on` is the trigger map.
  return (parse(text) as Workflow).on?.pull_request?.branches;
}

for (const workflow of WORKFLOWS) {
  Deno.test(
    `${workflow} pull_request branch filter includes milestone/* (Issue #3606)`,
    async () => {
      const branches = await readBranches(workflow);

      assert(
        Array.isArray(branches) && branches.length > 0,
        `${workflow} must declare a non-empty pull_request.branches filter`,
      );

      assert(
        branches.includes("milestone/*"),
        `${workflow} pull_request.branches must include 'milestone/*' so the ` +
          "gate runs on milestone sub-issue PRs; got: " +
          JSON.stringify(branches),
      );

      // The existing Develop gate must be preserved — the milestone glob is
      // additive, not a replacement.
      assert(
        branches.includes("Develop"),
        `${workflow} pull_request.branches must still include 'Develop'; got: ` +
          JSON.stringify(branches),
      );
    },
  );
}
