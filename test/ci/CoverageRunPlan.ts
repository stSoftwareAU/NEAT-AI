import { assert, assertEquals } from "@std/assert";
import {
  MAX_HEAP_MB,
  MIN_HEAP_MB,
  MIN_RETRY_HEAP_MB,
  planInitialRun,
  planOomRetry,
  planToShell,
  RETRY_DENO_JOBS,
  type RunPlan,
} from "../../scripts/coverage_run_plan.ts";

// ----------------------------------------------------------------------
// planInitialRun — sizing the shard's first run to the runner.
// ----------------------------------------------------------------------

Deno.test("planInitialRun: roomy runner gets 70% heap and full parallelism", () => {
  const plan = planInitialRun({ cpuCores: 16, totalMemoryMb: 32000 });
  // 70% of 32000 = 22400, clamped to the 8192 ceiling.
  assertEquals(plan.heapMb, MAX_HEAP_MB);
  assertEquals(plan.parallel, true);
  // Full parallelism leaves DENO_JOBS unset (defaults to CPU count).
  assertEquals(plan.denoJobs, null);
});

Deno.test("planInitialRun: standard CI runner (4c/16G) stays parallel", () => {
  const plan = planInitialRun({ cpuCores: 4, totalMemoryMb: 16000 });
  // 60% of 16000 = 9600, clamped to 8192.
  assertEquals(plan.heapMb, MAX_HEAP_MB);
  assertEquals(plan.parallel, true);
  assertEquals(plan.denoJobs, null);
});

Deno.test("planInitialRun: mid runner uses 60% heap under the ceiling", () => {
  const plan = planInitialRun({ cpuCores: 4, totalMemoryMb: 8000 });
  // 60% of 8000 = 4800, within [1024, 8192].
  assertEquals(plan.heapMb, 4800);
  assertEquals(plan.parallel, true);
});

Deno.test("planInitialRun: tiny runner falls back to serial with 50% heap", () => {
  const plan = planInitialRun({ cpuCores: 2, totalMemoryMb: 3000 });
  // 50% of 3000 = 1500.
  assertEquals(plan.heapMb, 1500);
  assertEquals(plan.parallel, false);
});

Deno.test("planInitialRun: heap never drops below the floor", () => {
  const plan = planInitialRun({ cpuCores: 1, totalMemoryMb: 1000 });
  assertEquals(plan.heapMb, MIN_HEAP_MB);
});

// ----------------------------------------------------------------------
// planOomRetry — the crux of #3174: recovery must stay parallel.
// ----------------------------------------------------------------------

Deno.test("planOomRetry: keeps --parallel but caps workers (never serial)", () => {
  const initial: RunPlan = { heapMb: 8192, denoJobs: null, parallel: true };
  const retry = planOomRetry(initial);
  // The whole point of the fix: recovery is still parallel.
  assertEquals(retry.parallel, true);
  // Worker pool is capped to reduce peak concurrent heap, but > 1.
  assertEquals(retry.denoJobs, RETRY_DENO_JOBS);
  assert(retry.denoJobs !== null && retry.denoJobs > 1);
});

Deno.test("planOomRetry: halves the heap", () => {
  const initial: RunPlan = { heapMb: 8192, denoJobs: null, parallel: true };
  assertEquals(planOomRetry(initial).heapMb, 4096);
});

Deno.test("planOomRetry: reduced heap is floored, not zeroed", () => {
  const initial: RunPlan = { heapMb: 700, denoJobs: null, parallel: true };
  // 700 / 2 = 350 -> floored to MIN_RETRY_HEAP_MB.
  assertEquals(planOomRetry(initial).heapMb, MIN_RETRY_HEAP_MB);
});

Deno.test("planOomRetry: an already-serial run stays serial on retry", () => {
  const initial: RunPlan = { heapMb: 1500, denoJobs: null, parallel: false };
  const retry = planOomRetry(initial);
  assertEquals(retry.parallel, false);
  assertEquals(retry.denoJobs, null);
  assertEquals(retry.heapMb, 750);
});

// ----------------------------------------------------------------------
// planToShell — the workflow eval contract.
// ----------------------------------------------------------------------

Deno.test("planToShell: emits parallel run with unset DENO_JOBS", () => {
  const shell = planToShell({ heapMb: 8192, denoJobs: null, parallel: true });
  assertEquals(
    shell,
    ["HEAP_MB=8192", "DENO_JOBS=", "PARALLEL=--parallel"].join("\n"),
  );
});

Deno.test("planToShell: emits capped workers on the recovery plan", () => {
  const shell = planToShell({ heapMb: 4096, denoJobs: 2, parallel: true });
  assertEquals(
    shell,
    ["HEAP_MB=4096", "DENO_JOBS=2", "PARALLEL=--parallel"].join("\n"),
  );
});

Deno.test("planToShell: serial plan emits an empty PARALLEL flag", () => {
  const shell = planToShell({ heapMb: 750, denoJobs: null, parallel: false });
  assertEquals(shell, ["HEAP_MB=750", "DENO_JOBS=", "PARALLEL="].join("\n"));
});

// ----------------------------------------------------------------------
// End-to-end: the CI runner's OOM recovery is scoped and parallel.
// ----------------------------------------------------------------------

Deno.test("initial->retry chain on the CI runner stays parallel and shrinks", () => {
  const initial = planInitialRun({ cpuCores: 4, totalMemoryMb: 16000 });
  const retry = planOomRetry(initial);
  assert(initial.parallel, "initial run must be parallel on the CI runner");
  assert(
    retry.parallel,
    "OOM recovery must remain parallel (no serial re-run)",
  );
  assert(
    retry.heapMb < initial.heapMb,
    "recovery must reduce the heap to relieve memory pressure",
  );
  assert(
    retry.denoJobs !== null && retry.denoJobs < 4,
    "recovery must cap workers below the full core count",
  );
});

// ----------------------------------------------------------------------
// Workflow wiring: the committed coverage.yaml must drive its run + OOM
// recovery through the (tested) plan script, not an ad-hoc serial re-run.
// ----------------------------------------------------------------------

Deno.test("coverage.yaml wires both run modes through the plan script", async () => {
  const yaml = await Deno.readTextFile(".github/workflows/coverage.yaml");
  assert(
    yaml.includes("scripts/coverage_run_plan.ts"),
    "the shard step must compute its run plan via coverage_run_plan.ts",
  );
  assert(
    yaml.includes("--mode=initial"),
    "the shard step must request the initial run plan",
  );
  assert(
    yaml.includes("--mode=retry"),
    "the OOM recovery must request the scoped retry plan",
  );
});
