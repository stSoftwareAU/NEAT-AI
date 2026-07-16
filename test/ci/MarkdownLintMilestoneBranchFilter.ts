import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies the Markdown Lint CI quality gate runs on milestone feature-branch
 * PRs, not just single-segment branches (Issue #3361).
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch (planning
 * delivery workflow). The workflow's `pull_request.branches` filter used the
 * single glob `*`, which in GitHub branch filters matches one path segment and
 * does NOT match a slash — so `milestone/<slug>` never matched and the lint
 * gate never ran on those PRs. They merged into the milestone branch
 * unchecked, the gap surfacing only later at the single rollup PR into the
 * default branch. Adding the single-level `milestone/*` glob (milestone names
 * are `milestone/<slug>` with no nested slashes) makes the gate run on every
 * intermediate milestone PR too.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting `pull_request.branches` filter, not on how it is written.
 */

interface PullRequestTrigger {
  branches?: string[];
}

interface Workflow {
  on?: { "pull_request"?: PullRequestTrigger };
}

const MARKDOWN_LINT_WORKFLOW = ".github/workflows/markdown-lint.yml";

async function readWorkflow(path: string): Promise<Workflow> {
  const text = await Deno.readTextFile(path);
  // `@std/yaml` keeps `on` as the string key "on" (it is not coerced to the
  // YAML 1.1 boolean `true`), so `wf.on` is the trigger map.
  return parse(text) as Workflow;
}

Deno.test(
  "markdown-lint.yml pull_request branch filter includes milestone/* (Issue #3361)",
  async () => {
    const wf = await readWorkflow(MARKDOWN_LINT_WORKFLOW);
    const branches = wf.on?.pull_request?.branches;

    assert(
      Array.isArray(branches) && branches.length > 0,
      "markdown-lint.yml must declare a non-empty pull_request.branches filter",
    );

    assert(
      branches.includes("milestone/*"),
      "markdown-lint.yml pull_request.branches must include 'milestone/*' so " +
        "the lint gate runs on milestone sub-issue PRs; got: " +
        JSON.stringify(branches),
    );

    // The pre-existing catch-all for single-segment branches must be
    // preserved — the milestone glob is additive, not a replacement.
    assert(
      branches.includes("*"),
      "markdown-lint.yml pull_request.branches must still include '*' so " +
        "single-segment branch PRs stay gated; got: " +
        JSON.stringify(branches),
    );
  },
);
