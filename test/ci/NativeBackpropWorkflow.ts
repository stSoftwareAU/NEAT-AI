import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * The native deadline job runs the real NEAT-AI-Backpropagation engines
 * (Issue #4119). These checks pin the workflow's shape so the gate cannot be
 * silently weakened: FFI must be required, the test files must run, the engine
 * pins must stay distinct, the job must be bounded, and the build step must
 * export the engine paths the tests read.
 */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, Job>;
}

const WORKFLOW = ".github/workflows/native-backprop.yml";
const JOB = "native-deadline";
const TEST_STEP = "Run the native deadline tests against the real engines";
const BUILD_STEP = "Build the NEW and LEGACY engines";
const CHECKOUT_STEP = "Checkout Code";

async function loadWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(WORKFLOW)) as Workflow;
}

function findJob(wf: Workflow): Job {
  const job = wf.jobs?.[JOB];
  assert(job, `workflow must define job ${JOB}`);
  return job;
}

function findStep(job: Job, name: string): Step {
  const step = job.steps?.find((s) => s.name === name);
  assert(step, `job ${JOB} must have step "${name}"`);
  return step;
}

Deno.test(
  "native-backprop.yml test step requires FFI (NEAT_AI_BACKPROP_REQUIRE_FFI=1)",
  async () => {
    const step = findStep(findJob(await loadWorkflow()), TEST_STEP);
    assertEquals(
      step.env?.NEAT_AI_BACKPROP_REQUIRE_FFI,
      "1",
      "missing engines must fail the job, not skip the deadline cases",
    );
  },
);

Deno.test(
  "native-backprop.yml test step requires the LEGACY engine (NEAT_AI_BACKPROP_REQUIRE_LEGACY=1)",
  async () => {
    const step = findStep(findJob(await loadWorkflow()), TEST_STEP);
    assertEquals(
      step.env?.NEAT_AI_BACKPROP_REQUIRE_LEGACY,
      "1",
      "a missing or mis-detected legacy engine must fail the job, not skip the legacy cases",
    );
  },
);

Deno.test(
  "native-backprop.yml test step runs the three native deadline test files",
  async () => {
    const step = findStep(findJob(await loadWorkflow()), TEST_STEP);
    const run = step.run ?? "";
    for (
      const file of [
        "test/architecture/training/NativeDeadlineIntegration.ts",
        "test/architecture/training/NativeBackpropCapabilities.ts",
        "test/architecture/training/RustTrainDirDeadline.ts",
      ]
    ) {
      assert(run.includes(file), `test step must run ${file}`);
    }
  },
);

Deno.test(
  "native-backprop.yml pins NEW and LEGACY engines to distinct 40-hex commits",
  async () => {
    const env = findJob(await loadWorkflow()).env ?? {};
    const newRev = env.NEW_ENGINE_REV ?? "";
    const legacyRev = env.LEGACY_ENGINE_REV ?? "";
    const sha = /^[0-9a-f]{40}$/;
    assert(
      sha.test(newRev),
      `NEW_ENGINE_REV must be a 40-hex commit: ${newRev}`,
    );
    assert(
      sha.test(legacyRev),
      `LEGACY_ENGINE_REV must be a 40-hex commit: ${legacyRev}`,
    );
    assert(
      newRev !== legacyRev,
      "NEW and LEGACY engines must be distinct commits so the legacy path is really exercised",
    );
  },
);

Deno.test(
  "native-backprop.yml has no push trigger and gates milestone/* branches",
  async () => {
    const wf = await loadWorkflow();
    const on = wf.on ?? {};
    assert(!("push" in on), "workflow must not trigger on push");
    const pr = on.pull_request as { branches?: string[] } | undefined;
    assert(pr, "workflow must trigger on pull_request");
    assert(
      pr.branches?.includes("milestone/*"),
      `pull_request.branches must include "milestone/*"; got ${
        JSON.stringify(pr.branches)
      }`,
    );
  },
);

Deno.test(
  "native-backprop.yml job is time-bounded and checkout does not persist credentials",
  async () => {
    const job = findJob(await loadWorkflow());
    assert(
      typeof job["timeout-minutes"] === "number" && job["timeout-minutes"] > 0,
      "job must declare a positive timeout-minutes",
    );
    const checkout = findStep(job, CHECKOUT_STEP);
    assertEquals(
      checkout.with?.["persist-credentials"],
      false,
      "checkout must set persist-credentials: false",
    );
  },
);

Deno.test(
  "native-backprop.yml build step exports the engine paths to GITHUB_ENV",
  async () => {
    const step = findStep(findJob(await loadWorkflow()), BUILD_STEP);
    const run = step.run ?? "";
    assert(
      run.includes("GITHUB_ENV"),
      "build step must write to GITHUB_ENV",
    );
    for (
      const name of [
        "NEAT_AI_BACKPROP_DEADLINE_NEW",
        "NEAT_AI_BACKPROP_DEADLINE_LEGACY",
        "NEAT_AI_BACKPROP_LIB_PATH",
      ]
    ) {
      assert(run.includes(`${name}=`), `build step must export ${name}`);
    }
  },
);
