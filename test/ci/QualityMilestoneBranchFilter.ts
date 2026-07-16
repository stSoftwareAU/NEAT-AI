import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies the Quality reviews CI quality gate runs on milestone feature-branch
 * PRs, not just PRs into `Develop` (Issue #3362).
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch (planning
 * delivery workflow). If the quality workflow's `pull_request.branches` filter
 * matched only `Develop`, the gate never ran on those PRs and they merged into
 * the milestone branch unchecked — the gap surfacing only later at the single
 * rollup PR into the default branch. Adding the single-level `milestone/*` glob
 * (milestone names are `milestone/<slug>` with no nested slashes) makes the
 * gate run on every intermediate milestone PR too.
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

const QUALITY_WORKFLOW = ".github/workflows/quality.yml";

async function readWorkflow(path: string): Promise<Workflow> {
  const text = await Deno.readTextFile(path);
  // `@std/yaml` keeps `on` as the string key "on" (it is not coerced to the
  // YAML 1.1 boolean `true`), so `wf.on` is the trigger map.
  return parse(text) as Workflow;
}

Deno.test(
  "quality.yml pull_request branch filter includes milestone/* (Issue #3362)",
  async () => {
    const wf = await readWorkflow(QUALITY_WORKFLOW);
    const branches = wf.on?.pull_request?.branches;

    assert(
      Array.isArray(branches) && branches.length > 0,
      "quality.yml must declare a non-empty pull_request.branches filter",
    );

    assert(
      branches.includes("milestone/*"),
      "quality.yml pull_request.branches must include 'milestone/*' so the " +
        "quality gate runs on milestone sub-issue PRs; got: " +
        JSON.stringify(branches),
    );

    // The existing Develop gate must be preserved — the milestone glob is
    // additive, not a replacement.
    assert(
      branches.includes("Develop"),
      "quality.yml pull_request.branches must still include 'Develop'; got: " +
        JSON.stringify(branches),
    );
  },
);
