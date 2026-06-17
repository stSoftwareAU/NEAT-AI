/**
 * Discovery worker V8 heap-budget plumbing (Issue #3024).
 *
 * Sub-issue of #3022 — addresses suspected root cause #1: discovery workers
 * spawn without the parent's V8 heap budget. On GRQ-23 the parent runs with a
 * large heap (~7852 MB) while the spawned discovery worker is left on the
 * default isolate heap (~269 MB observed), so the recording phase alone fills
 * it to CRITICAL and `AnalysisHeapGuard` aborts analysis even though the host
 * has plenty of headroom.
 *
 * ## Deno mechanism + caveats (the result of the #3024 investigation)
 *
 * Deno Web Workers do **not** accept a per-worker `--max-old-space-size` via the
 * `Worker` constructor the way Node `worker_threads` do — there is no `resourceLimits`
 * option, and setting the flag at runtime with `v8.setFlagsFromString(...)` does
 * **not** resize an isolate's old-space (the limit is fixed at isolate creation).
 * The only lever that actually resizes a worker isolate's old-space is the
 * **process-level** `--v8-flags=--max-old-space-size=<MB>` supplied when the
 * runtime is launched: Deno worker isolates inherit the process V8 flags.
 *
 * Therefore the contract is split across the process boundary:
 *   1. The external discovery runner (`worker/Discovery/run.sh`, out of this
 *      repo) launches Deno with `--v8-flags=--max-old-space-size=$DISCOVERY_HEAP_SIZE_MB`
 *      and exports `DISCOVERY_HEAP_SIZE_MB` so the library can see the target.
 *   2. This library reads `DISCOVERY_HEAP_SIZE_MB` ({@link resolveDiscoveryHeapBudgetMb}),
 *      threads the budget through `WorkerHandlerBase.createWorkerOrMock`, and on
 *      each spawn verifies the worker isolate's actual `heap_size_limit` against
 *      the configured budget, emitting a manual heap-limit log line (and a
 *      shortfall warning when the worker isolate did not inherit the budget).
 *
 * The verification log makes the GRQ-23 failure mode observable: if the worker
 * isolate is materially smaller than the configured budget, the warning fires so
 * the missing process-level flag is caught instead of silently aborting analysis.
 *
 * @module
 */

import v8 from "node:v8";

/**
 * Environment variable the external discovery runner sets to the target V8
 * old-space budget (in MB) for the discovery process and its workers.
 */
export const DISCOVERY_HEAP_SIZE_ENV = "DISCOVERY_HEAP_SIZE_MB";

/** Sanity floor: a configured budget below this many MB is treated as unset. */
const MIN_BUDGET_MB = 64;

/**
 * Fraction of the configured budget the worker isolate must reach before the
 * heap is considered "propagated". Below this the spawn logs a shortfall
 * warning (the GRQ-23 symptom: worker stuck on the ~269 MB default).
 */
const SHORTFALL_FRACTION = 0.9;

/** Minimal environment reader, satisfied by `Deno.env` and test fakes. */
export interface EnvReader {
  get(key: string): string | undefined;
}

/**
 * Resolve the configured discovery heap budget (in MB) from the environment.
 *
 * Reads {@link DISCOVERY_HEAP_SIZE_ENV}. Returns `undefined` when the variable
 * is unset, empty, non-numeric, non-integer, or below {@link MIN_BUDGET_MB}, so
 * a malformed value can never shrink a worker below the default.
 *
 * @param env - Environment reader (defaults to `Deno.env`).
 */
export function resolveDiscoveryHeapBudgetMb(
  env: EnvReader = Deno.env,
): number | undefined {
  let raw: string | undefined;
  try {
    raw = env.get(DISCOVERY_HEAP_SIZE_ENV) ?? undefined;
  } catch {
    // No --allow-env (or reader threw): treat as unconfigured.
    return undefined;
  }
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_BUDGET_MB) {
    return undefined;
  }
  return n;
}

/**
 * The current isolate's V8 old-space limit, in MB.
 *
 * Uses `node:v8` `getHeapStatistics().heap_size_limit` — `Deno.memoryUsage()`
 * reports committed `heapTotal`, not the configured limit, so it cannot detect
 * the parent/worker split this fix targets.
 */
export function currentHeapLimitMb(): number {
  return Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024));
}

/**
 * Build the parent-side log line recorded when a worker is spawned with a
 * configured budget. The parent cannot read the child isolate's heap (that is
 * authoritative only worker-side via {@link planWorkerHeapBudget}); this line
 * records the intended budget propagated to the spawn. Returns `undefined` when
 * no budget is configured.
 *
 * @param workerName - Name of the spawned worker.
 * @param budgetMb - Configured budget in MB, or `undefined` when unconfigured.
 */
export function describeBudgetPropagation(
  workerName: string,
  budgetMb: number | undefined,
): string | undefined {
  if (budgetMb === undefined) return undefined;
  return (
    `[WorkerHeapBudget] spawning worker '${workerName}' with configured V8 ` +
    `old-space budget ${budgetMb} MB (--max-old-space-size=${budgetMb}); ` +
    `worker isolate must inherit it from the process --v8-flags.`
  );
}

/** The decision produced by {@link planWorkerHeapBudget}. */
export interface WorkerHeapBudgetPlan {
  /** The configured budget (MB) that was applied to this spawn. */
  budgetMb: number;
  /** The worker isolate's actual old-space limit (MB) at spawn. */
  actualLimitMb: number;
  /**
   * V8 flag the launching process must carry for the worker to inherit the
   * budget. Recorded for the log line and for callers that build a runner.
   */
  flags: readonly string[];
  /** True when the worker isolate is materially smaller than the budget. */
  shortfall: boolean;
  /** Log level for {@link message} (`warn` on shortfall, else `info`). */
  level: "info" | "warn";
  /** Human-readable manual heap-limit log line. */
  message: string;
}

/**
 * Build the heap-limit verification plan for a spawned worker.
 *
 * Pure function (no I/O) so it is fully unit-testable: given the worker name,
 * the configured budget, and the worker isolate's actual limit, it produces the
 * manual heap-limit log line plus a shortfall flag. Returns `undefined` when no
 * budget is configured (nothing to verify or log).
 *
 * @param workerName - Name of the spawned worker (for the log line).
 * @param budgetMb - Configured budget in MB, or `undefined` when unconfigured.
 * @param actualLimitMb - The worker isolate's old-space limit in MB.
 */
export function planWorkerHeapBudget(
  workerName: string,
  budgetMb: number | undefined,
  actualLimitMb: number,
): WorkerHeapBudgetPlan | undefined {
  if (budgetMb === undefined) return undefined;

  const flags = [`--max-old-space-size=${budgetMb}`] as const;
  const shortfall = actualLimitMb < Math.floor(budgetMb * SHORTFALL_FRACTION);

  const base =
    `[WorkerHeapBudget] worker '${workerName}' configured V8 old-space budget ` +
    `${budgetMb} MB; isolate heap_size_limit ${actualLimitMb} MB`;
  const message = shortfall
    ? `${base} — SHORTFALL: worker did not inherit the budget. Launch the ` +
      `discovery process with --v8-flags=${
        flags[0]
      } so worker isolates inherit it.`
    : `${base} — within budget.`;

  return {
    budgetMb,
    actualLimitMb,
    flags,
    shortfall,
    level: shortfall ? "warn" : "info",
    message,
  };
}
