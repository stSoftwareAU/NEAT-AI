/**
 * Replay Helpers Module
 *
 * Utility functions for the discovery replay process, including
 * batch evaluation, combo index generation, score comparison,
 * and concurrent task mapping.
 *
 * Extracted from DiscoveryReplayRunner.ts as part of #1598.
 */

import { assertExists } from "@std/assert";
import { calculate as calculateScore } from "@architecture/Score.ts";
import type { WasmCacheConfig } from "../config/WasmCacheConfig.ts";
import type { CostName } from "../Costs.ts";
import type { Creature } from "../Creature.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { getLogger } from "@utils/Logger.ts";
import type { SuccessCacheEntry } from "./SuccessCache.ts";

type EvaluationTask = {
  kind: "original" | "single" | "combo";
  creature: Creature;
  entry?: SuccessCacheEntry;
  description?: string;
};

export type { EvaluationTask };

/**
 * Evaluate a batch of replay tasks across a set of workers.
 *
 * @internal
 */
export async function evaluateAll(
  workers: WorkerHandler[],
  tasks: EvaluationTask[],
  feedbackLoop: boolean,
  costOfGrowth: number,
): Promise<Array<EvaluationTask & { error: number; score: number }>> {
  const queue = tasks.map((task, index) => ({ task, index }));
  const results: Array<
    (EvaluationTask & { error: number; score: number }) | undefined
  > = new Array(tasks.length);

  const processNext = async (worker: WorkerHandler): Promise<void> => {
    const next = queue.shift();
    if (!next) return;
    const { task, index } = next;

    const response = await worker.evaluate(task.creature, feedbackLoop);
    assertExists(
      response.evaluate,
      "Worker did not return evaluation data.",
    );
    const error = response.evaluate.error;
    const score = calculateScore(task.creature, error, costOfGrowth);
    results[index] = { ...task, error, score };

    await processNext(worker);
  };

  await Promise.all(workers.map((worker) => processNext(worker)));
  return results.filter((r) => r !== undefined);
}

function isRemovalType(changeType: string): boolean {
  return changeType === "remove-low-impact" || changeType === "remove-neuron" ||
    changeType === "remove-synapse";
}

/**
 * Build indices for combo candidates from successful singles.
 *
 * Generates combination strategies: all-combined and removal-only subsets.
 */
export function buildComboIndices(
  successfulSingles: Array<{ entry: SuccessCacheEntry }>,
  maxPairwise: number,
  maxTriples: number,
): number[][] {
  const combos: number[][] = [];
  const count = successfulSingles.length;
  if (count < 2) return combos;

  // All.
  combos.push(Array.from({ length: count }, (_, i) => i));

  // All removals as a separate candidate outcome (when there are 2+ removals).
  const removalOnly = successfulSingles
    .map((s, i) => (isRemovalType(s.entry.changeType) ? i : -1))
    .filter((i) => i >= 0);
  if (removalOnly.length >= 2 && removalOnly.length < count) {
    combos.push(removalOnly);
  }

  // Replay intentionally only evaluates the all-successful combination.
  // Pairwise/triple exploration can be reintroduced later if needed.
  void maxPairwise;
  void maxTriples;
  return combos;
}

/**
 * Build a human-readable description for a combo candidate.
 */
export function describeCombo(entries: SuccessCacheEntry[]): string {
  const types = Array.from(new Set(entries.map((e) => e.changeType)));
  const removalOnly = types.every(isRemovalType);
  if (removalOnly) {
    return `✂️ Replayed ${entries.length} cached pruning change${
      entries.length === 1 ? "" : "s"
    }`;
  }
  return `🏆 Replayed ${entries.length} cached change${
    entries.length === 1 ? "" : "s"
  } (${types.join(", ")})`;
}

/**
 * Parse a claimed numeric value from creature tags.
 */
export function parseClaimedTagNumber(
  tags: Array<{ name: string; value?: string }> | undefined,
  key: "score" | "error",
): number | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const tag of tags) {
    if (!tag?.name) continue;
    if (tag.name.toLowerCase() !== key) continue;
    const raw = tag.value ?? "";
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Whether a claimed score differs meaningfully from a re-computed score.
 * Uses a relaxed relative threshold so we do not report drift from normal
 * floating-point and string round-trip noise.
 */
export function scoreMeaningfullyDifferent(
  claimed: number | undefined,
  actual: number,
): boolean {
  if (claimed === undefined) return false;
  if (!Number.isFinite(actual)) return true;
  const absDiff = Math.abs(claimed - actual);
  if (absDiff <= 1e-12) return false;
  const denom = Math.max(1, Math.abs(claimed), Math.abs(actual));
  return absDiff / denom > 1e-6;
}

/**
 * Set up a pool of WorkerHandler instances for replay evaluation.
 *
 * Workers are warmed sequentially to avoid cold-cache download storms.
 * Falls back to direct execution if a worker fails to initialise.
 */
export async function setupWorkerPool(params: {
  workerCount: number;
  dataDir: string;
  costName: CostName;
  customCost?: { filePath: string };
  wasmCache?: WasmCacheConfig;
}): Promise<WorkerHandler[]> {
  const { workerCount, dataDir, costName, customCost, wasmCache } = params;
  const workers: WorkerHandler[] = [];
  for (let i = 0; i < workerCount; i++) {
    const preferDirect = workerCount === 1;
    // Issue #1567: Propagate WASM cache limits to worker threads.
    let w = new WorkerHandler(
      dataDir,
      costName,
      preferDirect,
      customCost,
      wasmCache,
    );
    try {
      // Warm worker sequentially to avoid cold-cache download storms and
      // to ensure only usable workers are added to the pool.
      // deno-lint-ignore no-await-in-loop
      await w.waitUntilReady();
    } catch (err) {
      try {
        w.terminate();
      } catch {
        // Ignore termination errors.
      }
      if (!preferDirect) {
        getLogger().warn(
          "[DiscoveryReplayRunner] Worker init failed; falling back to direct execution for this worker slot.",
          err,
        );
        w = new WorkerHandler(dataDir, costName, true, customCost, wasmCache);
        // deno-lint-ignore no-await-in-loop
        await w.waitUntilReady();
      } else {
        throw err;
      }
    }
    workers.push(w);
  }
  return workers;
}

/**
 * Run an async function over inputs with bounded concurrency.
 */
export async function mapConcurrent<TIn, TOut>(
  inputs: readonly TIn[],
  concurrency: number,
  fn: (value: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: TOut[] = new Array(inputs.length);
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= inputs.length) return;
      // deno-lint-ignore no-await-in-loop -- This loop is the concurrency limiter; awaiting here is intentional.
      results[i] = await fn(inputs[i], i);
    }
  };

  const runners = Array.from(
    { length: Math.min(limit, inputs.length) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}
