import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";
import {
  DEFAULT_TIMINGS_PATH,
  loadTimings,
} from "../../scripts/shard_test_files.ts";

/**
 * The coverage merge job must publish the per-file duration map that the
 * cost-weighted shard planner consumes (Issue #4017). Without it the planner
 * silently degrades to round-robin and shards drift back to being balanced by
 * file count, which is what left one shard running ~7m while others finished
 * in ~1m15.
 *
 * This is a "what" test: it parses the committed workflow YAML and the
 * committed timings document, and asserts on the resulting configuration.
 */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function mergeSteps(): Promise<Step[]> {
  const wf = parse(await Deno.readTextFile(COVERAGE_WORKFLOW)) as Workflow;
  const steps = wf.jobs?.merge?.steps;
  assert(Array.isArray(steps), "coverage.yaml must declare merge job steps");
  return steps;
}

Deno.test("coverage.yaml merge job publishes per-file test timings", async () => {
  const steps = await mergeSteps();
  const step = steps.find((s) => s.run?.includes("--timings="));
  assert(
    step !== undefined,
    "merge job must run merge_junit.ts with --timings=<path>",
  );
  assert(
    step.run?.includes("scripts/merge_junit.ts"),
    "the timings map must come from the JUnit reports the merge job aggregates",
  );
});

Deno.test("coverage.yaml timings step scopes its write grant", async () => {
  const steps = await mergeSteps();
  const step = steps.find((s) => s.run?.includes("--timings="))!;
  // This job holds secrets.CODECOV_TOKEN; an unrestricted write grant would
  // reach $GITHUB_ENV / $GITHUB_PATH (Issue #3681).
  assert(
    step.run?.includes("--allow-write=test-timings.json"),
    "write grant must be scoped to the timings output file",
  );
  assert(
    !/--allow-write(\s|$)/.test(step.run ?? ""),
    "must never grant unrestricted --allow-write",
  );
  assert(
    step.run?.startsWith("set -euo pipefail"),
    "multi-line run steps must open with strict mode",
  );
});

Deno.test("coverage.yaml uploads the timings as a named artifact", async () => {
  const steps = await mergeSteps();
  const upload = steps.find(
    (s) =>
      s.uses?.startsWith("actions/upload-artifact@") &&
      s.with?.name === "test-timings",
  );
  assert(
    upload !== undefined,
    "merge job must upload a `test-timings` artifact so the committed map can be refreshed",
  );
  assertEquals(
    upload.with?.path,
    "test-timings.json",
    "upload exactly the timings file, never the whole workspace",
  );
});

Deno.test("the committed timings document is readable and non-trivial", async () => {
  const timings = await loadTimings(DEFAULT_TIMINGS_PATH);
  const files = Object.keys(timings);
  assert(
    files.length > 500,
    `expected timings for most of the suite, got ${files.length}`,
  );
  assert(
    files.every((file) => file.startsWith("test/") && file.endsWith(".ts")),
    "every key must be a repo-relative test module path",
  );
  const total = Object.values(timings).reduce((sum, s) => sum + s, 0);
  assert(total > 60, `recorded suite cost looks unmeasured: ${total}s`);
});
