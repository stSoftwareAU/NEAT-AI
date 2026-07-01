import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Guards the OOM-recovery invariant of `.github/workflows/coverage.yaml`
 * (Issue #3174). A transient out-of-memory / termination signal must NOT
 * collapse the shard into a whole-shard serial re-run (which blew the job
 * timeout). Instead the suite always runs with `--parallel`, and recovery
 * narrows the worker count via `DENO_JOBS` — parallelism is bounded, never
 * dropped.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting shard-run configuration (the observable command the runner
 * executes), not on any implementation detail of the tests themselves.
 */

interface Step {
  id?: string;
  name?: string;
  run?: string;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readShardRunScript(): Promise<string> {
  const text = await Deno.readTextFile(COVERAGE_WORKFLOW);
  const wf = parse(text) as Workflow;
  const steps = wf.jobs?.coverage?.steps ?? [];
  const runStep = steps.find((s) => s.id === "run_shard");
  assert(runStep, "coverage job must declare a `run_shard` step");
  assert(
    typeof runStep.run === "string" && runStep.run.length > 0,
    "run_shard step must have a `run` script",
  );
  return runStep.run;
}

Deno.test("coverage shard invokes deno test exactly once, always parallel", async () => {
  const run = await readShardRunScript();
  const denoTestCount = (run.match(/deno test\b/g) ?? []).length;
  // A single `run_tests` helper is the only path that launches the suite; both
  // the first attempt and the OOM retry flow through it. More than one
  // invocation would signal a re-introduced serial fallback path.
  assertEquals(
    denoTestCount,
    1,
    "there must be exactly one `deno test` invocation (no separate serial re-run path)",
  );
  // `--parallel` must be a literal, unconditional flag on the `deno test`
  // command — not gated behind a variable that could be emptied. Extract the
  // command block (from `deno test` to its output redirect) and assert the
  // flag is inside it.
  const block = run.match(/deno test\b[\s\S]*?junit-raw\.xml/);
  assert(block, "could not locate the deno test command block");
  assert(
    block[0].includes("--parallel"),
    "`--parallel` must be passed unconditionally on the deno test command (Issue #3174)",
  );
});

Deno.test("coverage shard controls worker count via DENO_JOBS, not by dropping --parallel", async () => {
  const run = await readShardRunScript();
  assert(
    run.includes("DENO_JOBS"),
    "worker count must be scoped via DENO_JOBS so recovery can narrow parallelism",
  );
});

Deno.test("coverage shard OOM recovery narrows workers instead of going serial", async () => {
  const run = await readShardRunScript();
  // The OOM/termination signals that trigger recovery.
  for (const code of ["134", "137", "143"]) {
    assert(
      run.includes(code),
      `OOM recovery must react to exit code ${code}`,
    );
  }
  // Recovery reduces the worker count (a numeric cap) rather than clearing the
  // parallel flag. RETRY_JOBS is the capped worker count fed to the retry.
  assert(
    run.includes("RETRY_JOBS"),
    "OOM retry must cap the worker count (RETRY_JOBS), keeping the run parallel",
  );
  const match = run.match(/RETRY_JOBS=(\d+)/);
  assert(match, "RETRY_JOBS must be set to a fixed worker count");
  const retryJobs = Number(match[1]);
  assert(
    Number.isInteger(retryJobs) && retryJobs >= 1,
    `RETRY_JOBS must be a positive worker count, got ${match[1]}`,
  );
});
