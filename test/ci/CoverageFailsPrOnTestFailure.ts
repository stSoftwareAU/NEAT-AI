import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * The Test Coverage workflow is the PR test gate (quality.yml does not run
 * tests). A failing or crashed shard must fail the merge job so the pull
 * request cannot go green.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the merge job's fail-closed steps, not on how the shell is written.
 */

interface Step {
  name?: string;
  "if"?: string;
  run?: string;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(COVERAGE_WORKFLOW)) as Workflow;
}

function mergeSteps(wf: Workflow): Step[] {
  const steps = wf.jobs?.merge?.steps;
  assert(
    Array.isArray(steps) && steps.length > 0,
    "coverage.yaml merge job must declare steps",
  );
  return steps;
}

Deno.test("coverage merge job fails the PR when tests failed", async () => {
  const steps = mergeSteps(await readWorkflow());
  const failTests = steps.find((s) => s.name === "Fail build if tests failed");
  assert(
    failTests,
    "merge job must declare a step named 'Fail build if tests failed'",
  );
  assert(
    typeof failTests["if"] === "string" &&
      failTests["if"].includes("failed") &&
      failTests["if"].includes("0"),
    "Fail build if tests failed must run when the gate reports failed shards; " +
      `got if=${failTests["if"]}`,
  );
  assert(
    typeof failTests.run === "string" && failTests.run.includes("exit 1"),
    "Fail build if tests failed must exit 1 so the PR check fails",
  );
});

Deno.test("coverage merge job fails the PR when a shard crashed", async () => {
  const steps = mergeSteps(await readWorkflow());
  const failCrash = steps.find((s) =>
    s.name === "Fail build if any shard crashed"
  );
  assert(
    failCrash,
    "merge job must declare a step named 'Fail build if any shard crashed'",
  );
  assert(
    typeof failCrash["if"] === "string" &&
      (failCrash["if"].includes("errored") ||
        failCrash["if"].includes("missing")),
    "Fail build if any shard crashed must run when shards error or vanish; " +
      `got if=${failCrash["if"]}`,
  );
  assert(
    typeof failCrash.run === "string" && failCrash.run.includes("exit 1"),
    "Fail build if any shard crashed must exit 1 so the PR check fails",
  );
});

Deno.test("coverage shard job runs deno test", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs?.coverage?.steps ?? [];
  const runShard = steps.find((s) => s.name === "Run test shard");
  assert(runShard, "coverage job must declare a 'Run test shard' step");
  assert(
    typeof runShard.run === "string" && runShard.run.includes("deno test"),
    "coverage shard must invoke deno test so PRs actually execute the suite",
  );
});
