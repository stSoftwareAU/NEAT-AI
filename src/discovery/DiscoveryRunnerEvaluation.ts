/**
 * Discovery Runner Evaluation Module
 *
 * Evaluation and caching helpers used by the DiscoveryRunner during
 * the two-phase scoring process.
 *
 * Extracted from DiscoveryRunner.ts as part of #1598.
 */

import { assert } from "@std/assert";
import { getLogger } from "../utils/Logger.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import type { Creature } from "../Creature.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { DiscoveryRunnerWorker } from "./DiscoveryRunnerTypes.ts";
import type { RequiredDiscoveryCacheConfig } from "../config/DiscoveryCacheConfig.ts";
import {
  logCacheStatistics,
  pruneCacheSync,
  pruneObsoleteSync,
} from "./DiscoveryCacheEviction.ts";
import { recordFailureSync } from "./FailureCache.ts";
import { getObsoleteDir, recordSuccessSync } from "./SuccessCache.ts";

export interface EvaluationTaskInput {
  kind: "original" | "candidate";
  creature: Creature;
  candidate?: DiscoveryCandidate;
}

export interface EvaluationTaskResult {
  kind: "original" | "candidate";
  candidate?: DiscoveryCandidate;
  error: number;
  score: number;
}

/**
 * Evaluate a batch of discovery tasks across a set of workers.
 *
 * Tasks are distributed round-robin across workers. Each worker processes
 * tasks sequentially from a shared queue until the queue is exhausted.
 */
export async function evaluateDiscoveryTasks(
  workers: DiscoveryRunnerWorker[],
  tasks: EvaluationTaskInput[],
  feedbackLoop: boolean,
  costOfGrowth: number,
  verbose: boolean,
): Promise<EvaluationTaskResult[]> {
  const queue = tasks.slice();
  const results: EvaluationTaskResult[] = [];

  const processNext = async (
    worker: DiscoveryRunnerWorker,
  ): Promise<void> => {
    const task = queue.shift();
    if (!task) return;

    const response = await worker.evaluate(task.creature, feedbackLoop);
    assert(
      response.evaluate,
      "Worker did not return evaluation data.",
    );
    const error = response.evaluate.error;
    const score = calculateScore(
      task.creature,
      error,
      costOfGrowth,
    );
    results.push({
      kind: task.kind,
      candidate: task.candidate,
      error,
      score,
    });

    if (verbose) {
      getLogger().info("[DiscoveryRunner] Evaluation result", {
        kind: task.kind,
        change: task.candidate?.change.type,
        error,
        score,
      });
    }

    await processNext(worker);
  };

  await Promise.all(workers.map((worker) => processNext(worker)));

  return results;
}

/**
 * Cache successful and failed candidates to their respective caches.
 */
export function cacheEvaluationResults(params: {
  evaluationResults: EvaluationTaskResult[];
  originalScore: number;
  originalError: number;
  baseCreature: Creature;
  successCacheDir?: string;
  failureCacheDir?: string;
  verbose: boolean;
  discoveryCacheConfig?: RequiredDiscoveryCacheConfig;
}): void {
  const {
    evaluationResults,
    originalScore,
    originalError,
    baseCreature,
    successCacheDir,
    failureCacheDir,
    verbose,
    discoveryCacheConfig,
  } = params;

  if (successCacheDir) {
    const successfulCandidates = evaluationResults
      .filter((result) => result.kind === "candidate")
      .filter((result) => result.score > originalScore)
      // Only cache single-step candidate types. Replay builds combinations on demand.
      .filter((result) =>
        !(result.candidate?.change.type?.startsWith("combo-"))
      )
      .filter((result) => result.candidate !== undefined);

    let cachedSuccessesCount = 0;
    for (const successful of successfulCandidates) {
      if (!successful.candidate) continue;
      recordSuccessSync(successCacheDir, successful.candidate, {
        originalScore,
        candidateScore: successful.score,
        scoreDelta: successful.score - originalScore,
        originalError,
        error: successful.error,
      }, baseCreature);
      cachedSuccessesCount++;
    }

    if (cachedSuccessesCount > 0 && verbose) {
      getLogger().info(
        `[DiscoveryRunner] Cached ${cachedSuccessesCount} successful candidate${
          cachedSuccessesCount === 1 ? "" : "s"
        } to success cache.`,
      );
    }
  }

  if (failureCacheDir) {
    const failedCandidates = evaluationResults
      .filter((result) => result.kind === "candidate")
      .filter((result) => result.score <= originalScore)
      .filter((result) => result.candidate !== undefined);

    let cachedFailuresCount = 0;
    for (const failed of failedCandidates) {
      if (failed.candidate) {
        recordFailureSync(failureCacheDir, failed.candidate, {
          originalScore,
          candidateScore: failed.score,
          scoreDelta: failed.score - originalScore,
          error: failed.error,
          originalError,
        }, baseCreature);
        cachedFailuresCount++;
      }
    }

    if (cachedFailuresCount > 0 && verbose) {
      getLogger().info(
        `[DiscoveryRunner] Cached ${cachedFailuresCount} failed candidate${
          cachedFailuresCount === 1 ? "" : "s"
        } to failure cache.`,
      );
    }
  }

  // Issue #1701: Prune caches after writing new entries.
  if (discoveryCacheConfig) {
    const ttlMs = discoveryCacheConfig.ttlDays * 24 * 60 * 60 * 1000;
    const obsoleteTTLMs = discoveryCacheConfig.obsoleteTTLDays * 24 * 60 * 60 *
      1000;

    if (successCacheDir) {
      const stats = pruneCacheSync(
        successCacheDir,
        discoveryCacheConfig.successMaxEntries,
        ttlMs,
      );
      logCacheStatistics("Success cache", stats);

      const obsoleteDir = getObsoleteDir(successCacheDir);
      const obsoleteEvicted = pruneObsoleteSync(obsoleteDir, obsoleteTTLMs);
      if (obsoleteEvicted > 0) {
        getLogger().info(
          `[DiscoveryCache] Obsolete: evicted ${obsoleteEvicted} archived entries`,
        );
      }
    }

    if (failureCacheDir) {
      const stats = pruneCacheSync(
        failureCacheDir,
        discoveryCacheConfig.failureMaxEntries,
        ttlMs,
      );
      logCacheStatistics("Failure cache", stats);
    }
  }
}
