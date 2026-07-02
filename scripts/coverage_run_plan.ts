#!/usr/bin/env -S deno run
/**
 * Compute the `deno test` run plan (V8 heap size, worker count, parallel flag)
 * for a coverage shard, and the *scoped* recovery plan used when a shard hits
 * an out-of-memory / termination signal (Issue #3174).
 *
 * Background: the coverage workflow used to react to an OOM by re-running the
 * **entire** slice single-threaded (`--parallel` dropped entirely) at half the
 * heap. On a memory-heavy shard that serial re-run blew the job timeout. This
 * module keeps the recovery *parallel* — it only reduces the V8 heap and caps
 * the number of concurrent test workers (`DENO_JOBS`) — so a transient OOM no
 * longer collapses to a slow whole-slice serial re-run.
 *
 * `deno test --parallel` sizes its worker pool from the `DENO_JOBS` environment
 * variable (falling back to the CPU count). Capping `DENO_JOBS` on the retry
 * therefore lowers peak concurrent heap usage while still running modules
 * concurrently — the common path stays parallel and the safety net stays fast.
 *
 * The pure planning functions are unit-tested in
 * `test/ci/CoverageRunPlan.ts`; the CLI wrapper is invoked from
 * `.github/workflows/coverage.yaml`.
 *
 * CLI usage — prints shell `KEY=value` assignments for `eval` in the workflow:
 *
 *   deno run scripts/coverage_run_plan.ts --mode=initial --cores=4 --memory-mb=16000
 *   deno run scripts/coverage_run_plan.ts --mode=retry   --cores=4 --memory-mb=16000
 */

/** Static description of the runner the shard executes on. */
export interface SystemInfo {
  /** Number of CPU cores available (`nproc`). */
  cpuCores: number;
  /** Total system memory in mebibytes (`MemTotal`). */
  totalMemoryMb: number;
}

/** A concrete `deno test` invocation plan. */
export interface RunPlan {
  /** `--max-old-space-size` value in MB. */
  heapMb: number;
  /**
   * Worker-pool cap exported as `DENO_JOBS`. `null` means "leave unset" so
   * Deno defaults to the CPU count (used for the initial full-parallel run).
   */
  denoJobs: number | null;
  /** Whether the `--parallel` flag is passed. */
  parallel: boolean;
}

/** Lower bound on the V8 heap so a plan never starves the runtime. */
export const MIN_HEAP_MB = 1024;
/** Upper bound on the V8 heap (a single shard never needs more). */
export const MAX_HEAP_MB = 8192;
/** Floor on the reduced-heap recovery run. */
export const MIN_RETRY_HEAP_MB = 512;
/**
 * Worker cap for the scoped OOM recovery. Small enough to cut peak concurrent
 * heap, but > 1 so recovery stays genuinely parallel (never serial).
 */
export const RETRY_DENO_JOBS = 2;

function clampHeap(heapMb: number, floor: number, ceil: number): number {
  return Math.max(floor, Math.min(ceil, Math.floor(heapMb)));
}

/**
 * Size the initial run to the runner. Roomy machines get a larger heap and
 * full parallelism; only a genuinely tiny runner (< 4 cores / < 4 GB) falls
 * back to serial — the CI runner (4 cores / 16 GB) always stays parallel.
 */
export function planInitialRun(sys: SystemInfo): RunPlan {
  const { cpuCores, totalMemoryMb } = sys;
  let heapMb: number;
  let parallel: boolean;

  if (cpuCores >= 8 && totalMemoryMb >= 8192) {
    heapMb = Math.floor((totalMemoryMb * 70) / 100);
    parallel = true;
  } else if (cpuCores >= 4 && totalMemoryMb >= 4096) {
    heapMb = Math.floor((totalMemoryMb * 60) / 100);
    parallel = true;
  } else {
    heapMb = Math.floor((totalMemoryMb * 50) / 100);
    parallel = false;
  }

  return {
    heapMb: clampHeap(heapMb, MIN_HEAP_MB, MAX_HEAP_MB),
    // Full parallelism defaults to the CPU count — leave DENO_JOBS unset.
    denoJobs: null,
    parallel,
  };
}

/**
 * Scoped recovery for an OOM/termination signal. Halves the heap (floored) and
 * — crucially — keeps `--parallel` while capping the worker pool to
 * {@link RETRY_DENO_JOBS}, so recovery lowers peak memory without collapsing to
 * a whole-slice serial re-run. A run that was already serial (tiny runner)
 * stays serial with the reduced heap.
 */
export function planOomRetry(initial: RunPlan): RunPlan {
  const heapMb = clampHeap(
    Math.floor(initial.heapMb / 2),
    MIN_RETRY_HEAP_MB,
    MAX_HEAP_MB,
  );
  if (!initial.parallel) {
    return { heapMb, denoJobs: null, parallel: false };
  }
  return { heapMb, denoJobs: RETRY_DENO_JOBS, parallel: true };
}

/**
 * Serialise a plan to shell `KEY=value` lines for `eval` in the workflow.
 * `DENO_JOBS` is emitted empty when unset so the workflow can safely `export`
 * it without leaking a stale value.
 */
export function planToShell(plan: RunPlan): string {
  return [
    `HEAP_MB=${plan.heapMb}`,
    `DENO_JOBS=${plan.denoJobs ?? ""}`,
    `PARALLEL=${plan.parallel ? "--parallel" : ""}`,
  ].join("\n");
}

function parseIntArg(args: Map<string, string>, key: string): number {
  const raw = args.get(key);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} must be a positive number, got: ${raw}`);
  }
  return Math.floor(value);
}

function parseArgs(argv: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const sys: SystemInfo = {
    cpuCores: parseIntArg(args, "cores"),
    totalMemoryMb: parseIntArg(args, "memory-mb"),
  };
  const mode = args.get("mode") ?? "initial";
  const initial = planInitialRun(sys);
  const plan = mode === "retry" ? planOomRetry(initial) : initial;
  console.log(planToShell(plan));
}
