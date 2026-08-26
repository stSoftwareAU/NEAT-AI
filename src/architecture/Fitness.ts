import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";
import { DatasetError } from "@errors/DatasetError.ts";
import { toScorerStrictError } from "@errors/ScorerStrictError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { orderForEvaluation } from "@multithreading/EvaluationScheduling.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { tryBatchScoreWithRustScorer } from "../score/BatchRustScorerBridge.ts";
import { getEnvRustScorerConfig } from "../score/RustScorerBridge.ts";
import { BatchScorerError } from "../score/BatchScorerReconciler.ts";
import { buildBatchScorerDiagnostic } from "../score/BatchScorerDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import type { BuiltInCostName } from "@costs";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import {
  isBuiltInCostName,
  nativeDatasetScoringEligibility,
} from "../score/NativeDatasetScoringEligibility.ts";
import { resolveRecurrentDirectorySupport } from "../score/RecurrentDirectoryProbe.ts";

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
 * Issue #1862: Supports topology-aware grouping. When topology grouping is
 * enabled, creatures with identical network structure are adjacent in the
 * evaluation queue, maximising WASM compilation cache hits.
 *
 * Issue #2245: Receives only fast-pool workers that are dedicated to
 * evaluation. This eliminates the need for reactive `isRunningLongTask()`
 * filtering since fast-pool workers never run discovery or training.
 *
 * Issue #3566: Every supplied worker participates. The `maxConcurrentEvaluations`
 * cap was removed — it defaulted to "no cap", and the fast/heavy pool split
 * already reserves capacity for training and discovery.
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
   * Creatures scored via the native batch (one-pass) rust-scorer path during
   * the most recent `calculate()` call (Issue #3234).
   *
   * Split out from {@link lastScoredCreatureCount} — which spans both backends
   * — so a silent regression where the batch path breaks and every creature
   * quietly falls back to the slow per-creature worker path is visible as a
   * zero here instead of blending into the combined total.
   */
  lastCreaturesBatchScored = 0;

  /**
   * Creatures scored via the per-creature worker path during the most recent
   * `calculate()` call (Issue #3234). Includes recurrent creatures that never
   * enter the batch path and any creatures re-scored after a batch fallback.
   */
  lastCreaturesPerCreatureScored = 0;

  /**
   * True when a batch attempt failed during the most recent `calculate()` call
   * and its creatures reverted to the per-creature worker path (Issue #3234).
   * A partial/whole fallback must stay visible, never masked as success.
   */
  lastBatchFallbackOccurred = false;

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

  /**
   * Raw configured cost name, defaulted to `"MSE"` exactly as `NeatConfig`
   * does. Kept alongside {@link costName} so the eligibility predicate sees
   * the configured value rather than `undefined` (Issue #3854).
   */
  private readonly configuredCostName: string;

  /**
   * Issue #3854: a `customCost` module is configured. `NeatConfig.costName`
   * stays `"MSE"` in that case (Issue #3776), so without this flag the batch
   * scorer was handed `--cost MSE` while the workers evaluated the user's cost
   * — off-loading a custom cost the public contract promises never to
   * off-load.
   */
  private readonly customCostConfigured: boolean;

  /**
   * Issue #3854: number of configured `outputRanges` constraints. The batch
   * scorer bypasses the workers — and therefore the TypeScript out-of-range
   * penalty (Issue #1620) — so a non-zero count keeps the whole generation on
   * the per-creature worker path rather than silently dropping the penalty.
   */
  private readonly outputRangeCount: number;

  /**
   * Issue #3865: the run's resolved scorer config — `NeatOptions.rustScorer`
   * layered over `NEAT_AI_RUST_SCORER_*`. Left `undefined` only by callers that
   * never resolved one (direct construction in tests), in which case the env
   * layer is read lazily so behaviour is unchanged.
   */
  private readonly rustScorer: RequiredRustScorerConfig | undefined;

  constructor(
    workers: WorkerHandler[],
    growth: number,
    feedbackLoop: boolean,
    evalConfig?: RequiredParallelEvaluationConfig,
    dataDir?: string,
    costName?: string,
    outputRanges?: ReadonlyArray<RequiredOutputRange>,
    customCostConfigured?: boolean,
    rustScorer?: RequiredRustScorerConfig,
  ) {
    this.workers = workers;
    this.feedbackLoop = feedbackLoop;
    this.growth = growth;
    this.evalConfig = evalConfig ?? DEFAULT_PARALLEL_EVALUATION_CONFIG;
    this.dataDir = dataDir;
    this.configuredCostName = costName ?? "MSE";
    this.customCostConfigured = customCostConfigured === true;
    this.costName = this.customCostConfigured
      ? undefined
      : toBuiltInCostName(this.configuredCostName);
    this.outputRangeCount = outputRanges?.length ?? 0;
    this.rustScorer = rustScorer;
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
   * WASM cache utilisation.
   *
   * @param population - Array of creatures to evaluate
   * @param additionalWorkers - Issue #2313: Extra workers (e.g. idle heavy-pool
   *   workers) temporarily assisting the fast pool for this evaluation only.
   * @param signal - Optional abort signal (GRQ #4141). When aborted, remaining
   *   unevaluated creatures take the worst score so the generation can finish
   *   without waiting on a stalled worker.
   * @returns Promise that resolves when all evaluations are complete
   */
  async calculate(
    population: Creature[],
    additionalWorkers?: WorkerHandler[],
    signal?: AbortSignal,
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
      // Issue #3234: reset per-backend scorer-utilisation counters alongside
      // the existing telemetry resets.
      this.lastCreaturesBatchScored = 0;
      this.lastCreaturesPerCreatureScored = 0;
      this.lastBatchFallbackOccurred = false;
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
    // Issue #3234: split the scored-creature tally by backend so the batch
    // (one-pass) path and the per-creature worker path can be distinguished.
    let batchScoredCount = 0;
    let workerScoredCount = 0;
    this.lastBatchScorerInvocations = 0;
    this.lastBatchFallbackOccurred = false;

    // Issue #2422: When the external rust scorer is enabled in directory
    // mode, invoke it once for the whole generation, map results back to
    // creatures, and compute each creature's score on the main thread.
    // This eliminates the per-creature `rust_scorer` process spawn on the
    // worker side. Any reconciliation failure is logged and we fall back
    // to the per-creature worker path so the generation still completes.
    //
    // Issue #2517: The external `rust_scorer` used to reject directory-mode
    // batches containing any `forwardOnly=false` creature, so the population
    // was partitioned and recurrent creatures took the per-creature worker
    // path. Issue #3870: NEAT-AI-scorer#579 threads each creature's own flag
    // through the batch loop, so a mixed population can be scored in one
    // invocation — but only on a binary new enough to do it. The capability is
    // probed (see `RecurrentDirectoryProbe.ts`); an older binary keeps the
    // partition and behaves exactly as before.
    //
    // Issue #3854: `outputRanges`, a custom cost, and `feedbackLoop` on a
    // recurrent creature all diverge between the engines, and the batch path
    // bypasses the workers that would apply them. Ask the shared eligibility
    // predicate rather than re-deriving the rule, so the batch and per-creature
    // call sites cannot drift apart.
    // Issue #3865: read the run's one resolved config. Falling back to the env
    // layer keeps direct constructions (tests) behaving exactly as before.
    const rustScorerConfig = this.rustScorer ?? getEnvRustScorerConfig();

    // After any batch attempt (success, skip, or failure), this list
    // holds the creatures still needing the per-creature worker path.
    let creaturesForWorkerPath: Creature[] = uniqueQueue;

    if (
      rustScorerConfig.enabled && rustScorerConfig.batch &&
      this.dataDir !== undefined
    ) {
      // Issue #3870: the eligibility question is asked per creature with that
      // creature's real `forwardOnlyGuaranteed`. The hard-coded `true` this
      // replaced was only true because the partition below guaranteed it; with
      // recurrent creatures now allowed into the batch it would be a lie, and
      // `feedbackLoop: true` recurrent creatures would silently batch under
      // per-record state resets — the divergence #3854 gated.
      const forwardOnlyCreatures: Creature[] = [];
      const recurrentCreatures: Creature[] = [];
      const refusedCreatures: Creature[] = [];
      for (const creature of uniqueQueue) {
        const eligibility = nativeDatasetScoringEligibility({
          costName: this.configuredCostName,
          customCostConfigured: this.customCostConfigured,
          forwardOnlyGuaranteed: creature.forwardOnlyGuaranteed,
          feedbackLoop: this.feedbackLoop,
          outputRangeCount: this.outputRangeCount,
        });
        if (!eligibility.eligible) {
          refusedCreatures.push(creature);
        } else if (creature.forwardOnlyGuaranteed) {
          forwardOnlyCreatures.push(creature);
        } else {
          recurrentCreatures.push(creature);
        }
      }

      // Probing costs a subprocess, so only ask when there is a recurrent
      // creature whose fate the answer would change.
      const recurrentBatchable = recurrentCreatures.length > 0 &&
        await resolveRecurrentDirectorySupport(
          rustScorerConfig,
          this.dataDir!,
        );
      const batchCreatures = recurrentBatchable
        ? [...forwardOnlyCreatures, ...recurrentCreatures]
        : forwardOnlyCreatures;
      const batchRemainder = recurrentBatchable
        ? refusedCreatures
        : [...refusedCreatures, ...recurrentCreatures];

      // One INFO line per generation summarising the partition. Operators use
      // it to see at a glance how much of the population is batching —
      // per-creature logging would be far too noisy.
      if (batchCreatures.length > 0 || batchRemainder.length > 0) {
        getLogger().info(
          `[NEAT-AI] Batch scorer partition: ${forwardOnlyCreatures.length} ` +
            `forwardOnly batched, ${
              recurrentBatchable ? recurrentCreatures.length : 0
            } recurrent batched, ${batchRemainder.length} per-creature`,
        );
      }

      if (batchCreatures.length > 0) {
        try {
          const batchRun = await tryBatchScoreWithRustScorer(
            batchCreatures,
            this.dataDir!,
            rustScorerConfig,
            this.costName,
          );
          this.lastBatchScorerInvocations = batchRun.invocations;
          if (batchRun.results) {
            for (const creature of batchCreatures) {
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
                batchScoredCount++;
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
            // Batch handled every creature it accepted — workers only need to
            // score the remainder the eligibility predicate or the scorer's
            // capability kept back.
            creaturesForWorkerPath = batchRemainder;
          }
        } catch (err) {
          // Issue #3541: a corrupt dataset is not a transient scorer issue —
          // the per-creature and WASM paths read the same bytes. Propagate so
          // the run fails once on the scorer's own diagnostic.
          if (err instanceof DatasetError) throw err;
          // Issue #3815: strict mode makes the fallback itself fatal — an
          // entirely dead native batch path must never reconcile to a green
          // run. The escalated error keeps the scorer's stderr verbatim.
          if (rustScorerConfig.strict) {
            throw toScorerStrictError(
              err,
              "Batch rust scorer failed under NEAT_AI_RUST_SCORER_STRICT",
              "BATCH_FALLBACK",
            );
          }
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
            ? buildBatchScorerDiagnostic(err, batchCreatures)
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
          // Issue #3234: mark the fallback so it is counted per-run rather
          // than silently absorbed by the worker path's success.
          this.lastBatchFallbackOccurred = true;
        }
      }
      // batchCreatures.length === 0 — no temp dir, no spawn. The worker path
      // already covers every creature the batch could not take.
    }

    // Issue #2934: Cost-aware ordering of the evaluation queue. Creatures are
    // sorted longest-cost-first (LPT) so the most expensive evaluations start
    // early and the makespan "tail" — where workers fall idle waiting for the
    // last few evaluations — is filled with cheap creatures. This reduces the
    // per-generation `fastIdleMs`/`heavyIdleMs` reported by the throughput
    // metrics layer without changing any score (the ordering is a pure
    // function of topology, so seeded runs stay deterministic).
    //
    // Issue #1862: Topology grouping is preserved as a tiebreak — same-topology
    // creatures share a cost, so cost-then-hash ordering keeps them contiguous
    // for WASM compilation cache reuse while still front-loading heavy blocks.
    // Issue #2517: `creaturesForWorkerPath` excludes any creatures already
    // scored by the batch path; it is identical to `uniqueQueue` whenever
    // batch is disabled, nothing was batchable, or batch failed.
    const queue: Creature[] = creaturesForWorkerPath;
    orderForEvaluation(queue, {
      topologyGrouping: this.evalConfig.topologyGrouping,
    });

    // Issue #1289: Work-stealing pattern - each worker continuously pulls
    // creatures from the shared queue until it is empty.
    // Issue #1481: Use index pointer instead of Array.shift() for O(1) dequeue.
    let front = 0;

    // Issue #2313: Combine dedicated fast-pool workers with any idle
    // heavy-pool workers temporarily assisting this evaluation.
    // Issue #2245: Every worker here is dedicated to evaluation, so no
    // isRunningLongTask() filtering or busy-worker fallback is needed.
    // Issue #3566: All of them evaluate — the removed maxConcurrentEvaluations
    // cap defaulted to 0 (no cap), so this was already the only behaviour.
    const allWorkers = additionalWorkers && additionalWorkers.length > 0
      ? [...this.workers, ...additionalWorkers]
      : this.workers;

    let settleAbort: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<undefined>((resolve) => {
        settleAbort = () => resolve(undefined);
        if (signal.aborted) {
          settleAbort();
          return;
        }
        signal.addEventListener("abort", () => settleAbort?.(), {
          once: true,
        });
      })
      : undefined;

    const processNext = async (worker: WorkerHandler): Promise<void> => {
      if (signal?.aborted || front >= queue.length) return;
      const creature = queue[front++];

      const evaluatePromise = worker.evaluate(creature, this.feedbackLoop);
      const responseData = abortPromise
        ? await Promise.race([evaluatePromise, abortPromise])
        : await evaluatePromise;
      if (!responseData) return;
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
        workerScoredCount++;
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
    try {
      await Promise.all(allWorkers.map((worker) => processNext(worker)));
    } finally {
      // Unstick the abort race so a completed calculate() does not leak a
      // pending promise into --trace-leaks.
      settleAbort?.();
    }

    // GRQ #4141: a watchdog abort must not leave unscored creatures in the
    // population — evolve() asserts every member has a score.
    if (signal?.aborted) {
      for (const creature of uniqueQueue) {
        if (creature.score === undefined) {
          addTag(creature, "error", "Infinity");
          creature.score = -Infinity;
          addTag(creature, "score", creature.score.toString());
        }
      }
    }

    // Issue #2424: Publish scorer telemetry for throughput metrics assembly.
    this.lastScorerMs = scorerMsAccum;
    // Issue #3234: publish the per-backend split. The combined count is kept
    // for existing throughput consumers and must equal batch + worker.
    this.lastCreaturesBatchScored = batchScoredCount;
    this.lastCreaturesPerCreatureScored = workerScoredCount;
    this.lastScoredCreatureCount = batchScoredCount + workerScoredCount;
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
  return isBuiltInCostName(costName) ? costName : undefined;
}
