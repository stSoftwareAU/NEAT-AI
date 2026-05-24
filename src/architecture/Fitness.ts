import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { tryBatchScoreWithRustScorer } from "../score/BatchRustScorerBridge.ts";
import { getEnvRustScorerConfig } from "../score/RustScorerBridge.ts";
import { BatchScorerError } from "../score/BatchScorerReconciler.ts";
import { buildBatchScorerDiagnostic } from "../score/BatchScorerDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import { BUILT_IN_COST_NAMES, type BuiltInCostName } from "@costs";

/**
 * Evaluates fitness scores for a population of creatures.
 *
 * Issue #1289: Uses a parallel work-stealing pattern to distribute creature
 * evaluations across all available workers simultaneously. Each worker
 * consumes creatures from a shared queue, ensuring optimal load balancing
 * without the overhead of reactive idle-listener scheduling.
 *
 * Issue #1016: Deduplicates creatures by UUID before evaluation. Creatures
 * with identical UUIDs are evaluated once and the score is copied to all
 * duplicates.
 *
 * Issue #1862: Supports topology-aware grouping and configurable concurrency.
 * When topology grouping is enabled, creatures with identical network structure
 * are adjacent in the evaluation queue, maximising WASM compilation cache hits.
 * The maxConcurrentEvaluations setting caps how many workers participate.
 *
 * Issue #2245: Receives only fast-pool workers that are dedicated to
 * evaluation. This eliminates the need for reactive `isRunningLongTask()`
 * filtering since fast-pool workers never run discovery or training.
 */
export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;
  private feedbackLoop: boolean;
  private evalConfig: RequiredParallelEvaluationConfig;

  /**
   * Peak pending-task depth observed on the fast pool during the most recent
   * `calculate()` call.
   *
   * Issue #2330: Captured at fitness start — when the shared work-stealing
   * queue has its maximum depth — so throughput diagnostics can report how
   * deep the backlog became without adding overhead inside the hot loop.
   */
  lastQueueMaxDepth = 0;

  /**
   * Aggregate main-thread wall time spent inside `calculateScore()` during
   * the most recent `calculate()` call, in milliseconds.
   *
   * Issue #2424: Isolates the scorer cost from worker evaluation so
   * throughput diagnostics can flag machines where the main thread is the
   * bottleneck. Accumulates across every scored creature in the fitness loop
   * using a single `performance.now()` pair per call — cheap enough to run
   * unconditionally.
   */
  lastScorerMs = 0;

  /**
   * Number of unique creatures that had their score computed on the main
   * thread during the most recent `calculate()` call.
   *
   * Issue #2424: Excludes cached duplicates (resolved by UUID copy) so the
   * derived creatures/sec metric reflects real scorer work. A single
   * counter increment per scored creature — no per-creature logging.
   */
  lastScoredCreatureCount = 0;

  /**
   * Number of `rust_scorer` processes spawned during the most recent
   * `calculate()` call.
   *
   * Issue #2422: In batch mode a generation with N creatures triggers
   * exactly one scorer process. Zero means batch mode was disabled,
   * unavailable, or fell back to the per-creature worker path.
   */
  lastBatchScorerInvocations = 0;

  /**
   * Data directory passed to the external `rust_scorer` binary in batch
   * mode (Issue #2422). `undefined` disables batch scoring regardless of
   * configuration, matching the behaviour of environments where no dataset
   * is wired through to Fitness.
   */
  private dataDir: string | undefined;

  /**
   * Issue #2745: Configured cost name (`NeatConfig.costName`) passed through
   * to the batch rust scorer via `--cost <NAME>` so the native scorer
   * computes the same cost as the TS layer. Only built-in cost names are
   * forwarded — custom (user-registered) costs cannot be off-loaded to
   * the external binary and stay on the TS/WASM path.
   */
  private costName: BuiltInCostName | undefined;

  constructor(
    workers: WorkerHandler[],
    growth: number,
    feedbackLoop: boolean,
    evalConfig?: RequiredParallelEvaluationConfig,
    dataDir?: string,
    costName?: string,
  ) {
    this.workers = workers;
    this.feedbackLoop = feedbackLoop;
    this.growth = growth;
    this.evalConfig = evalConfig ?? DEFAULT_PARALLEL_EVALUATION_CONFIG;
    this.dataDir = dataDir;
    this.costName = toBuiltInCostName(costName);
  }

  /**
   * Issue #2422: Provide the dataset directory so batch rust scoring can
   * invoke the external `rust_scorer` binary with `(creatures_dir, data_dir)`
   * arguments once per generation. Without a data directory, batch scoring
   * is skipped and the per-creature worker path is used as before.
   */
  setDataDir(dataDir: string): void {
    this.dataDir = dataDir;
  }

  /**
   * Calculate fitness scores for a population of creatures.
   *
   * Issue #1016: Deduplicates creatures by UUID before evaluation.
   * Issue #1289: Distributes evaluations across the worker pool using a
   * work-stealing pattern for parallel execution.
   * Issue #1862: Optionally groups creatures by topology hash for better
   * WASM cache utilisation, and caps concurrent evaluations.
   *
   * @param population - Array of creatures to evaluate
   * @param additionalWorkers - Issue #2313: Extra workers (e.g. idle heavy-pool
   *   workers) temporarily assisting the fast pool for this evaluation only.
   * @returns Promise that resolves when all evaluations are complete
   */
  async calculate(
    population: Creature[],
    additionalWorkers?: WorkerHandler[],
  ): Promise<void> {
    // Filter creatures that need evaluation (score is undefined)
    const needsEvaluation = population.filter((c) => c.score === undefined);

    // Issue #1016: Deduplicate by UUID to avoid redundant evaluations
    const duplicates = new Map<string, Creature[]>();
    const uniqueQueue: Creature[] = [];

    for (const creature of needsEvaluation) {
      const uuid = CreatureUtil.makeUUID(creature);

      if (!duplicates.has(uuid)) {
        duplicates.set(uuid, [creature]);
        uniqueQueue.push(creature);
      } else {
        duplicates.get(uuid)!.push(creature);
      }
    }

    if (uniqueQueue.length === 0) {
      this.lastQueueMaxDepth = 0;
      this.lastScorerMs = 0;
      this.lastScoredCreatureCount = 0;
      this.lastBatchScorerInvocations = 0;
      return;
    }

    // Issue #2330: Record peak pending-task depth before workers drain the
    // queue. The shared work-stealing queue starts at its maximum size and
    // shrinks monotonically, so the initial `uniqueQueue.length` is the
    // peak backlog for the fast pool during this fitness phase.
    this.lastQueueMaxDepth = uniqueQueue.length;

    // Issue #2424: Reset scorer telemetry counters. Each worker's
    // `processNext` will increment these after every `calculateScore()`
    // call. Using bare numeric mutation keeps the hot path allocation-free.
    let scorerMsAccum = 0;
    let scoredCount = 0;
    this.lastBatchScorerInvocations = 0;

    // Issue #2422: When the external rust scorer is enabled in directory
    // mode, invoke it once for the whole generation, map results back to
    // creatures, and compute each creature's score on the main thread.
    // This eliminates the per-creature `rust_scorer` process spawn on the
    // worker side. Any reconciliation failure is logged and we fall back
    // to the per-creature worker path so the generation still completes.
    //
    // Issue #2517: The external `rust_scorer` rejects directory-mode
    // batches that contain any `forwardOnly=false` creature. Partition the
    // population so only the forwardOnly subset enters the batch path —
    // recurrent creatures take the per-creature worker path directly. This
    // prevents one "poison" creature from collapsing the whole batch and
    // losing the once-per-generation performance benefit.
    const rustScorerConfig = getEnvRustScorerConfig();
    const batchEnabled = rustScorerConfig.enabled && rustScorerConfig.batch &&
      this.dataDir !== undefined;

    // After any batch attempt (success, skip, or failure), this list
    // holds the creatures still needing the per-creature worker path.
    let creaturesForWorkerPath: Creature[] = uniqueQueue;

    if (batchEnabled) {
      const forwardOnlyCreatures: Creature[] = [];
      const recurrentCreatures: Creature[] = [];
      for (const creature of uniqueQueue) {
        if (creature.forwardOnly === true) {
          forwardOnlyCreatures.push(creature);
        } else {
          recurrentCreatures.push(creature);
        }
      }

      // One INFO line per generation summarising the partition. Operators
      // need this to see at a glance how often "poison" recurrent creatures
      // shrink the batch — per-creature logging would be far too noisy.
      getLogger().info(
        `[NEAT-AI] Batch scorer partition: ${forwardOnlyCreatures.length} ` +
          `forwardOnly batched, ${recurrentCreatures.length} recurrent ` +
          `per-creature`,
      );

      if (forwardOnlyCreatures.length > 0) {
        try {
          const batchRun = await tryBatchScoreWithRustScorer(
            forwardOnlyCreatures,
            this.dataDir!,
            rustScorerConfig,
            this.costName,
          );
          this.lastBatchScorerInvocations = batchRun.invocations;
          if (batchRun.results) {
            for (const creature of forwardOnlyCreatures) {
              const record = batchRun.results.get(creature);
              if (!record) continue;
              const error = record.error;
              if (!Number.isFinite(error) || error < 0) {
                addTag(creature, "error", "Infinity");
                creature.score = -Infinity;
              } else {
                addTag(creature, "error", error.toString());
                const scoreStart = performance.now();
                creature.score = calculateScore(creature, error, this.growth);
                scorerMsAccum += performance.now() - scoreStart;
                scoredCount++;
              }
              addTag(creature, "score", creature.score.toString());

              // Mirror the duplicate-fan-out from the per-creature path so
              // population score invariants hold identically in batch mode.
              const uuid = creature.uuid;
              if (uuid) {
                const dupes = duplicates.get(uuid);
                if (dupes) {
                  const errorTag = getTag(creature, "error");
                  const scoreTag = getTag(creature, "score");
                  for (const duplicate of dupes) {
                    if (duplicate !== creature) {
                      duplicate.score = creature.score;
                      if (errorTag) addTag(duplicate, "error", errorTag);
                      if (scoreTag) addTag(duplicate, "score", scoreTag);
                    }
                  }
                }
              }
            }
            // Batch handled the forwardOnly subset — workers only need to
            // score the recurrent remainder.
            creaturesForWorkerPath = recurrentCreatures;
          }
        } catch (err) {
          // Surface batch reconciliation failures as explicit log errors per
          // the acceptance criteria, then fall back to the per-creature path
          // so the generation is not lost to a transient scorer issue.
          // Issue #2518: enrich the log line with population composition
          // counters and per-creature metadata for any UUID we can extract
          // from the rust scorer's stderr or the typed error itself, so
          // operators can trace the producer of the offending creature(s)
          // without re-running the workload.
          const detail = err instanceof Error ? err.message : String(err);
          const diagnostic = err instanceof Error
            ? buildBatchScorerDiagnostic(err, forwardOnlyCreatures)
            : undefined;
          if (err instanceof BatchScorerError) {
            getLogger().error(
              `[NEAT-AI] Batch rust scorer reconciliation failed ` +
                `(${err.reason}): ${detail}; ${diagnostic!.message}; ` +
                `falling back to per-creature scoring.`,
            );
          } else if (diagnostic) {
            getLogger().error(
              `[NEAT-AI] Batch rust scorer invocation failed: ${detail}; ` +
                `${diagnostic.message}; falling back to per-creature scoring.`,
            );
          } else {
            getLogger().error(
              `[NEAT-AI] Batch rust scorer invocation failed: ${detail}; ` +
                `falling back to per-creature scoring.`,
            );
          }
          // creaturesForWorkerPath stays at uniqueQueue so the worker path
          // re-scores everything, including the forwardOnly creatures the
          // batch attempt failed to score.
        }
      }
      // forwardOnlyCreatures.length === 0 — no temp dir, no spawn. The
      // worker path already covers every recurrent creature.
    }

    // Issue #1862: Sort by topology hash to cluster same-topology creatures.
    // This improves WASM compilation cache hit rates because workers pull
    // from the front of the queue, so same-topology creatures flow to the
    // same worker via the work-stealing pattern.
    // Issue #2123: Avoid unnecessary array copy. When grouping is disabled,
    // use the worker queue directly. When enabled, pre-compute hashes into a
    // Map for O(1) lookups during sort instead of O(n log n) hash
    // computations.
    // Issue #2517: `creaturesForWorkerPath` excludes any creatures already
    // scored by the batch path; it is identical to `uniqueQueue` whenever
    // batch is disabled, the forwardOnly subset is empty, or batch failed.
    const queue: Creature[] = creaturesForWorkerPath;
    if (this.evalConfig.topologyGrouping) {
      const hashCache = new Map<Creature, string>();
      for (const creature of queue) {
        hashCache.set(creature, CreatureUtil.getTopologyHash(creature));
      }
      queue.sort((a, b) => {
        return hashCache.get(a)!.localeCompare(hashCache.get(b)!);
      });
    }

    // Issue #1289: Work-stealing pattern - each worker continuously pulls
    // creatures from the shared queue until it is empty.
    // Issue #1481: Use index pointer instead of Array.shift() for O(1) dequeue.
    let front = 0;

    // Issue #2313: Combine dedicated fast-pool workers with any idle
    // heavy-pool workers temporarily assisting this evaluation.
    const allWorkers = additionalWorkers && additionalWorkers.length > 0
      ? [...this.workers, ...additionalWorkers]
      : this.workers;

    // Issue #1862: Cap the number of concurrent workers if configured.
    // Issue #2245: Workers are now guaranteed to be from the fast pool
    // (dedicated to evaluation), so no isRunningLongTask() filtering
    // or busy-worker fallback is needed.
    const maxConcurrent = this.evalConfig.maxConcurrentEvaluations;
    const activeWorkers = maxConcurrent > 0
      ? allWorkers.slice(0, maxConcurrent)
      : allWorkers;

    const processNext = async (worker: WorkerHandler): Promise<void> => {
      if (front >= queue.length) return;
      const creature = queue[front++];

      const responseData = await worker.evaluate(creature, this.feedbackLoop);
      if (!responseData.evaluate) {
        throw new ValidationError("Invalid response from worker.", "OTHER");
      }

      const error = responseData.evaluate.error;
      delete responseData.evaluate;

      // Issue #2211: When a worker encounters a WASM panic (RuntimeError:
      // unreachable), it returns POSITIVE_INFINITY as the error value.
      // Rather than crashing the entire evolution with an assertion failure
      // in Score.calculate(), assign the worst possible score so natural
      // selection removes the creature gracefully.
      if (!Number.isFinite(error) || error < 0) {
        if (responseData.error) {
          getLogger().warn(
            `Worker error for creature ${creature.uuid ?? "unknown"}: ` +
              `${responseData.error.name}: ${responseData.error.message}`,
          );
        }
        addTag(creature, "error", "Infinity");
        creature.score = -Infinity;
      } else {
        addTag(creature, "error", error.toString());
        // Issue #2424: Time the main-thread scorer call. One
        // `performance.now()` pair per creature is inexpensive compared
        // to the scorer itself and gives operators the per-generation
        // scorer wall time they need to tune batch mode.
        const scoreStart = performance.now();
        creature.score = calculateScore(creature, error, this.growth);
        scorerMsAccum += performance.now() - scoreStart;
        scoredCount++;
      }
      addTag(creature, "score", creature.score.toString());

      // Issue #1016: Copy score and tags to duplicate creatures
      const uuid = creature.uuid;
      if (uuid) {
        const dupes = duplicates.get(uuid);
        if (dupes) {
          const errorTag = getTag(creature, "error");
          const scoreTag = getTag(creature, "score");
          for (const duplicate of dupes) {
            if (duplicate !== creature) {
              duplicate.score = creature.score;
              if (errorTag) {
                addTag(duplicate, "error", errorTag);
              }
              if (scoreTag) {
                addTag(duplicate, "score", scoreTag);
              }
            }
          }
        }
      }

      // Recursively process next creature from the queue
      await processNext(worker);
    };

    // Start all active workers processing the queue concurrently
    await Promise.all(activeWorkers.map((worker) => processNext(worker)));

    // Issue #2424: Publish scorer telemetry for throughput metrics assembly.
    this.lastScorerMs = scorerMsAccum;
    this.lastScoredCreatureCount = scoredCount;
  }
}

/**
 * Narrow an unconstrained `costName` string to a `BuiltInCostName`, or
 * return `undefined` if the value is unknown to the built-in registry
 * (e.g. a user-registered custom cost). Issue #2745.
 */
function toBuiltInCostName(
  costName: string | undefined,
): BuiltInCostName | undefined {
  if (costName === undefined) return undefined;
  return (BUILT_IN_COST_NAMES as readonly string[]).includes(costName)
    ? (costName as BuiltInCostName)
    : undefined;
}
