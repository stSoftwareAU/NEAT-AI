/**
 * RLEpisodeFitness.ts — Episode-rollout scorer for `Creature.evolveRL()`
 * (Issue #2628, part of #2624; parallel-pool path added in #2612).
 *
 * Counterpart to {@link EpisodicFitness} but speaks the new class-shaped
 * {@link EpisodeAdapter} contract from Issue #2626 and drives the
 * library-owned {@link runEpisode} runner from Issue #2627. The shared
 * per-generation seed set (see `EvolveRLSeedSet.ts`) is set by
 * `Creature.evolveRL()` before each fitness phase so every creature in
 * generation `g` is evaluated against the same seeds.
 *
 * Like {@link EpisodicFitness}, this scorer extends {@link Fitness} so it
 * satisfies the structural contract used by `NeatEvolution.ts`. The base
 * constructor is invoked with an empty worker pool because the dataset
 * pool has no role here; an optional {@link EpisodeWorkerPool} (Issue
 * #2612) parallelises per-creature rollouts when supplied. The mean and
 * reward → error mapping always run on the main thread so the score path
 * stays the single source of truth.
 */

import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { getLogger } from "@utils/Logger.ts";
import type { EpisodeAdapter } from "@creature/EpisodeAdapter.ts";
import { runEpisode } from "@creature/EpisodeRunner.ts";
import type { EpisodeWorkerPool } from "@creature/EpisodeWorkerPool.ts";
import type { EpisodeTrialsEvent } from "@creature/EpisodicFitnessTypes.ts";
import { defaultRewardToError } from "@creature/EpisodicFitnessTypes.ts";

/**
 * Per-trial outcome captured during fitness evaluation. We retain `steps`
 * alongside `reward` so the parallel and inline paths can share a single
 * post-processing routine (see {@link RLEpisodeFitness.applyScore}); steps
 * feed the opt-in milestone statistics (#2629) and `reward` drives the
 * fitness mean.
 */
interface TrialOutcome {
  readonly reward: number;
  readonly steps: number;
}

/**
 * Constructor dependencies for {@link RLEpisodeFitness}. Mirrors the
 * caller-tunable surface of `EvolveRLOptions` plus the `growth` cost factor
 * pulled from {@link NeatConfig}.
 */
export interface RLEpisodeFitnessDeps<S, A> {
  readonly adapter: EpisodeAdapter<S, A>;
  readonly growth: number;
  readonly rewardToError?: (reward: number) => number;
  readonly onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;
  /**
   * Optional parallel-rollout pool (Issue #2612). When supplied, every
   * unique creature is dispatched through the pool instead of running its
   * episodes inline on the main thread. The mean and any reward → error
   * mapping still happen here so the score path stays single-source-of-truth.
   */
  readonly workerPool?: EpisodeWorkerPool;
}

/**
 * Fitness scorer that runs episode rollouts using the new class-shaped
 * {@link EpisodeAdapter} and the library-owned {@link runEpisode} runner.
 *
 * The per-generation seed set is supplied by `Creature.evolveRL()` before each
 * fitness phase via {@link RLEpisodeFitness.setSeedSet}, so every creature in
 * the same generation plays the same seeds. The mean return across the seed
 * set becomes the creature's fitness; that mean is mapped to the non-negative
 * `error` slot via {@link RLEpisodeFitnessDeps.rewardToError} (default
 * `error = max(0, -reward)`) and finally to a NEAT score via
 * {@link calculateScore}.
 *
 * When a worker pool is supplied, every unique creature is dispatched
 * through the pool concurrently; otherwise the rollouts run serially on
 * the main thread (the pre-#2612 behaviour). Either way the per-trial
 * seed is a pure function of `(generation, episodeIndex)`, so the final
 * score is byte-identical across thread counts for a fixed evolve seed.
 */
export class RLEpisodeFitness<S, A> extends Fitness {
  private readonly adapter: EpisodeAdapter<S, A>;
  private readonly episodicGrowth: number;
  private readonly rewardToError: (reward: number) => number;
  private readonly onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;
  /** Issue #2612: optional pool for parallel per-creature rollouts. */
  private readonly workerPool?: EpisodeWorkerPool;

  /** 1-based generation counter used in {@link EpisodeTrialsEvent.generation}. */
  private generation = 0;
  /** Per-generation seed set. Replaced before every fitness phase. */
  private seedSet: readonly number[] = [];
  /**
   * Issue #2629: when `true`, accumulate per-episode step counts and the
   * fittest creature's mean return so `Creature.evolveRL()` can build a
   * milestone payload. Off by default — collection cost is skipped entirely
   * when statistics are disabled, not merely hidden.
   */
  private statisticsEnabled = false;
  /**
   * Issue #2629: per-generation statistics accumulated during `calculate()`.
   * Reset by {@link beginGenerationStatistics} at the start of each fitness
   * phase. `undefined` when statistics collection is disabled.
   */
  private generationStats?: {
    totalSteps: number;
    episodeCount: number;
    bestMeanReward: number;
    bestUuid: string | undefined;
  };

  constructor(deps: RLEpisodeFitnessDeps<S, A>) {
    // Empty worker pool: the base class is only here for the structural
    // contract; dataset-style workers play no role in episode rollouts.
    super([], deps.growth, false);
    this.adapter = deps.adapter;
    this.episodicGrowth = deps.growth;
    this.rewardToError = deps.rewardToError ?? defaultRewardToError;
    this.onEpisodeTrials = deps.onEpisodeTrials;
    this.workerPool = deps.workerPool;
  }

  /**
   * Update the generation counter. Called from `Creature.evolveRL()` after
   * each `neat.evolve()` so the next fitness phase emits the correct
   * generation number on per-creature trial events.
   */
  setGeneration(generation: number): void {
    this.generation = generation;
  }

  /**
   * Replace the per-generation seed set. The same set is used for every
   * creature scored in the next `calculate()` call so within-generation
   * comparisons are fair.
   */
  setSeedSet(seedSet: readonly number[]): void {
    if (seedSet.length === 0) {
      throw new Error("RLEpisodeFitness.setSeedSet: seedSet must be non-empty");
    }
    this.seedSet = seedSet;
  }

  /**
   * Issue #2629: enable opt-in milestone statistics collection. When `false`
   * (the default), per-episode step counts and best-mean-reward tracking are
   * skipped entirely on the hot path.
   */
  setStatisticsEnabled(enabled: boolean): void {
    this.statisticsEnabled = enabled;
    if (!enabled) this.generationStats = undefined;
  }

  /**
   * Issue #2629: reset the per-generation statistics accumulator. Called by
   * `Creature.evolveRL()` before each fitness phase so the figures returned
   * by {@link consumeGenerationStatistics} cover only one generation.
   *
   * No-op when statistics are disabled.
   */
  beginGenerationStatistics(): void {
    if (!this.statisticsEnabled) return;
    this.generationStats = {
      totalSteps: 0,
      episodeCount: 0,
      bestMeanReward: Number.NEGATIVE_INFINITY,
      bestUuid: undefined,
    };
  }

  /**
   * Issue #2629: read and clear the per-generation statistics accumulator.
   *
   * Returns `undefined` when statistics are disabled or
   * {@link beginGenerationStatistics} was never called. Callers that need to
   * record more than one generation must read after each `calculate()`.
   */
  consumeGenerationStatistics():
    | {
      totalSteps: number;
      episodeCount: number;
      bestMeanReward: number;
      bestUuid: string | undefined;
    }
    | undefined {
    const stats = this.generationStats;
    this.generationStats = undefined;
    return stats;
  }

  /**
   * Score every creature in `population` whose `creature.score` is undefined.
   *
   * Mirrors {@link Fitness.calculate} semantics: deduplicates by UUID, scores
   * each unique creature once across the configured seed set, then fans the
   * score and tags out to duplicates. When an {@link EpisodeWorkerPool} was
   * supplied via the constructor, per-creature rollouts fan out to the pool
   * concurrently; otherwise they run inline. Either way the determinism
   * contract holds because the per-trial seed is a pure function of
   * `(generation, episodeIndex)` set on the main thread before this call.
   */
  override async calculate(
    population: Creature[],
    _additionalWorkers?: WorkerHandler[],
  ): Promise<void> {
    // Reset telemetry counters consumed by NeatEvolution.ts after every
    // generation. These are read once per generation so it is safe to do this
    // unconditionally.
    this.lastQueueMaxDepth = 0;
    this.lastScorerMs = 0;
    this.lastScoredCreatureCount = 0;
    this.lastBatchScorerInvocations = 0;

    if (this.seedSet.length === 0) {
      throw new Error(
        "RLEpisodeFitness.calculate invoked before setSeedSet — " +
          "Creature.evolveRL() must seed each generation",
      );
    }

    const needsEvaluation = population.filter((c) => c.score === undefined);

    // Deduplicate by UUID so two pointers to the same genome cost a single
    // rollout. The duplicate fan-out at the end of the loop mirrors the
    // dataset path so downstream code that relies on `score`/`error` tags
    // being present on every creature still works.
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

    if (uniqueQueue.length === 0) return;

    this.lastQueueMaxDepth = uniqueQueue.length;

    // Validate every creature's I/O against the adapter once before
    // scheduling any rollouts. Failing fast keeps the worker pool from
    // accepting an obviously-malformed creature.
    for (const creature of uniqueQueue) {
      if (creature.input !== this.adapter.observationLength) {
        throw new ValidationError(
          `Creature input ${creature.input} does not match adapter ` +
            `observationLength ${this.adapter.observationLength}`,
          "OTHER",
        );
      }
    }

    // Collect per-creature trial outcomes. With a worker pool, every
    // creature is dispatched concurrently; without one, they run serially
    // on the main thread (the legacy path).
    const trialsPerCreature: TrialOutcome[][] = new Array(uniqueQueue.length);
    if (this.workerPool) {
      // Promise.all preserves index order, so `trialsPerCreature[i]`
      // belongs to `uniqueQueue[i]` regardless of which worker served it.
      const tasks = uniqueQueue.map((creature, i) =>
        this.workerPool!.runEpisodes(creature, this.seedSet)
          .then((outcomes) => {
            const trials: TrialOutcome[] = new Array(outcomes.length);
            for (let t = 0; t < outcomes.length; t++) {
              trials[t] = {
                reward: outcomes[t].reward,
                steps: outcomes[t].steps,
              };
            }
            trialsPerCreature[i] = trials;
          })
          .catch((err) => {
            if (err instanceof ActivationError) {
              getLogger().warn(
                `[RLEpisodeFitness] Activation failure on creature ` +
                  `${creature.uuid?.substring(0, 8) ?? "unknown"}: ` +
                  `${err.message}`,
              );
              const trials: TrialOutcome[] = new Array(this.seedSet.length);
              for (let t = 0; t < this.seedSet.length; t++) {
                trials[t] = { reward: Number.NEGATIVE_INFINITY, steps: 0 };
              }
              trialsPerCreature[i] = trials;
              return;
            }
            throw err;
          })
      );
      await Promise.all(tasks);
    } else {
      for (let i = 0; i < uniqueQueue.length; i++) {
        // deno-lint-ignore no-await-in-loop
        trialsPerCreature[i] = await this.collectTrialsInline(uniqueQueue[i]);
      }
    }

    // Post-processing: identical for both paths — cumulative/mean,
    // rewardToError, score, tags, telemetry callback, duplicate fan-out.
    let scorerMsAccum = 0;
    let scoredCount = 0;
    for (let i = 0; i < uniqueQueue.length; i++) {
      const creature = uniqueQueue[i];
      const trials = trialsPerCreature[i];
      const stats = this.applyScore(creature, trials);
      scorerMsAccum += stats.scoreMs;
      if (stats.scored) scoredCount++;
      this.fanOutToDuplicates(creature, duplicates);
    }

    this.lastScorerMs = scorerMsAccum;
    this.lastScoredCreatureCount = scoredCount;
  }

  /**
   * Inline (single-thread) per-creature rollout. Identical to the
   * pre-#2612 hot loop but extracted so the parallel path can share the
   * same post-processing.
   */
  private async collectTrialsInline(
    creature: Creature,
  ): Promise<TrialOutcome[]> {
    const trials: TrialOutcome[] = new Array(this.seedSet.length);
    for (let t = 0; t < this.seedSet.length; t++) {
      const seed = this.seedSet[t];
      try {
        // Seeds must run serially so the creature's per-trial returns line
        // up 1:1 with this.seedSet.
        // deno-lint-ignore no-await-in-loop
        const result = await runEpisode(this.adapter, creature, seed);
        trials[t] = { reward: result.returnValue, steps: result.steps };
      } catch (err) {
        if (err instanceof ActivationError) {
          getLogger().warn(
            `[RLEpisodeFitness] Activation failure on creature ` +
              `${creature.uuid?.substring(0, 8) ?? "unknown"}: ` +
              `${err.message}`,
          );
          trials[t] = { reward: Number.NEGATIVE_INFINITY, steps: 0 };
        } else {
          throw err;
        }
      }
    }
    return trials;
  }

  /**
   * Map per-trial outcomes to creature `score` + tags + telemetry. Returns
   * a small bookkeeping struct so the caller can update its scorer-time
   * accumulators. Also folds in the opt-in milestone statistics (#2629)
   * so both the inline and parallel paths share the same step accounting.
   */
  private applyScore(
    creature: Creature,
    trials: TrialOutcome[],
  ): { scoreMs: number; scored: boolean } {
    let cumulative = 0;
    let nonFinite = false;
    const trialRewards: number[] = new Array(trials.length);
    for (let t = 0; t < trials.length; t++) {
      const reward = trials[t].reward;
      trialRewards[t] = reward;
      if (!Number.isFinite(reward)) nonFinite = true;
      cumulative += reward;
      // Issue #2629: accumulate step counts only when statistics are on.
      // Skipping the branch keeps the disabled-stats path zero-cost.
      if (this.generationStats !== undefined) {
        this.generationStats.totalSteps += trials[t].steps;
        this.generationStats.episodeCount += 1;
      }
    }
    const meanReward = cumulative / trials.length;

    // Issue #2629: track the best (highest) mean return seen this generation
    // so the milestone payload can report `bestScore` as the raw RL return
    // rather than the NEAT score (which folds in a growth penalty).
    if (
      this.generationStats !== undefined &&
      Number.isFinite(meanReward) &&
      meanReward > this.generationStats.bestMeanReward
    ) {
      this.generationStats.bestMeanReward = meanReward;
      this.generationStats.bestUuid = creature.uuid;
    }

    if (nonFinite || !Number.isFinite(meanReward)) {
      addTag(creature, "error", "Infinity");
      addTag(creature, "trialRewards", trialRewards.join(","));
      creature.score = -Infinity;
      addTag(creature, "score", creature.score.toString());
      addTag(creature, "meanReward", meanReward.toString());
      return { scoreMs: 0, scored: false };
    }

    let error = this.rewardToError(meanReward);
    if (!Number.isFinite(error) || error < 0) {
      // Fail safe: a misbehaving rewardToError must not corrupt the
      // population. Treat as worst case so natural selection drops the
      // creature instead of crashing the run.
      getLogger().warn(
        `[RLEpisodeFitness] rewardToError returned non-positive-finite ` +
          `(${error}) for reward ${meanReward}; mapping to Infinity.`,
      );
      error = Number.POSITIVE_INFINITY;
    }

    let scoreMs = 0;
    let scored = false;
    if (Number.isFinite(error)) {
      addTag(creature, "error", error.toString());
      const scoreStart = performance.now();
      creature.score = calculateScore(creature, error, this.episodicGrowth);
      scoreMs = performance.now() - scoreStart;
      scored = true;
    } else {
      addTag(creature, "error", "Infinity");
      creature.score = -Infinity;
    }

    addTag(creature, "score", creature.score.toString());
    addTag(creature, "trialRewards", trialRewards.join(","));
    // Issue #2629: tag the mean return so `Creature.evolveRL()` can recover
    // the fittest creature's raw RL return for milestone telemetry, even
    // when the fittest is an elite that survived from a previous generation
    // and was not re-evaluated this round.
    addTag(creature, "meanReward", meanReward.toString());

    // Per-creature variance telemetry. Population-standard-deviation
    // (divisor = N) is the natural choice when the trials enumerate the
    // entire sample (no bias correction needed).
    let stdReward = 0;
    if (trialRewards.length > 1) {
      let variance = 0;
      for (let t = 0; t < trialRewards.length; t++) {
        const d = trialRewards[t] - meanReward;
        variance += d * d;
      }
      variance /= trialRewards.length;
      stdReward = Math.sqrt(variance);
    }

    this.onEpisodeTrials?.({
      generation: this.generation,
      creatureUuid: creature.uuid,
      trialRewards,
      meanReward,
      stdReward,
      error,
    });

    return { scoreMs, scored };
  }

  /**
   * Mirror score and tags from `creature` to every duplicate-by-UUID entry.
   * Identical to the duplicate fan-out in {@link Fitness.calculate} so the
   * population invariants downstream code relies on still hold.
   */
  private fanOutToDuplicates(
    creature: Creature,
    duplicates: Map<string, Creature[]>,
  ): void {
    const uuid = creature.uuid;
    if (!uuid) return;
    const dupes = duplicates.get(uuid);
    if (!dupes) return;
    const errorTag = getTag(creature, "error");
    const scoreTag = getTag(creature, "score");
    const trialsTag = getTag(creature, "trialRewards");
    const meanRewardTag = getTag(creature, "meanReward");
    for (const duplicate of dupes) {
      if (duplicate === creature) continue;
      duplicate.score = creature.score;
      if (errorTag) addTag(duplicate, "error", errorTag);
      if (scoreTag) addTag(duplicate, "score", scoreTag);
      if (trialsTag) addTag(duplicate, "trialRewards", trialsTag);
      if (meanRewardTag) addTag(duplicate, "meanReward", meanRewardTag);
    }
  }
}
