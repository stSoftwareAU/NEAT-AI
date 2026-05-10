/**
 * RLEpisodeFitness.ts — In-process episode-rollout scorer for
 * `Creature.evolveRL()` (Issue #2628, part of #2624).
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
 * constructor is invoked with an empty worker pool; multi-threaded rollouts
 * via the worker pool are tracked in #2612 and slot in here later — this
 * implementation runs every episode inline.
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
import type { EpisodeTrialsEvent } from "@creature/EpisodicFitnessTypes.ts";
import { defaultRewardToError } from "@creature/EpisodicFitnessTypes.ts";

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
}

/**
 * Fitness scorer that runs episode rollouts inline using the new class-shaped
 * {@link EpisodeAdapter} and the library-owned {@link runEpisode} runner.
 *
 * The per-generation seed set is supplied by `Creature.evolveRL()` before each
 * fitness phase via {@link RLEpisodeFitness.setSeedSet}, so every creature in
 * the same generation plays the same seeds. The mean return across the seed
 * set becomes the creature's fitness; that mean is mapped to the non-negative
 * `error` slot via {@link RLEpisodeFitnessDeps.rewardToError} (default
 * `error = max(0, -reward)`) and finally to a NEAT score via
 * {@link calculateScore}.
 */
export class RLEpisodeFitness<S, A> extends Fitness {
  private readonly adapter: EpisodeAdapter<S, A>;
  private readonly episodicGrowth: number;
  private readonly rewardToError: (reward: number) => number;
  private readonly onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;

  /** 1-based generation counter used in {@link EpisodeTrialsEvent.generation}. */
  private generation = 0;
  /** Per-generation seed set. Replaced before every fitness phase. */
  private seedSet: readonly number[] = [];

  constructor(deps: RLEpisodeFitnessDeps<S, A>) {
    // Empty worker pool: the base class is only here for the structural
    // contract; episode rollouts run on the main thread.
    super([], deps.growth, false);
    this.adapter = deps.adapter;
    this.episodicGrowth = deps.growth;
    this.rewardToError = deps.rewardToError ?? defaultRewardToError;
    this.onEpisodeTrials = deps.onEpisodeTrials;
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
   * Score every creature in `population` whose `creature.score` is undefined.
   *
   * Mirrors {@link Fitness.calculate} semantics: deduplicates by UUID, scores
   * each unique creature once across the configured seed set, then fans the
   * score and tags out to duplicates. The `additionalWorkers` argument is
   * accepted for API parity but ignored — episode rollouts run inline.
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

    let scorerMsAccum = 0;
    let scoredCount = 0;

    for (const creature of uniqueQueue) {
      if (creature.input !== this.adapter.observationLength) {
        throw new ValidationError(
          `Creature input ${creature.input} does not match adapter ` +
            `observationLength ${this.adapter.observationLength}`,
          "OTHER",
        );
      }

      const trialRewards: number[] = new Array(this.seedSet.length);
      let cumulative = 0;
      let nonFinite = false;

      for (let t = 0; t < this.seedSet.length; t++) {
        const seed = this.seedSet[t];
        let reward: number;
        try {
          // Seeds must run serially so the creature's per-trial returns line
          // up 1:1 with this.seedSet.
          // deno-lint-ignore no-await-in-loop
          const result = await runEpisode(this.adapter, creature, seed);
          reward = result.returnValue;
        } catch (err) {
          if (err instanceof ActivationError) {
            getLogger().warn(
              `[RLEpisodeFitness] Activation failure on creature ` +
                `${creature.uuid?.substring(0, 8) ?? "unknown"}: ` +
                `${err.message}`,
            );
            reward = Number.NEGATIVE_INFINITY;
          } else {
            throw err;
          }
        }

        if (!Number.isFinite(reward)) nonFinite = true;
        trialRewards[t] = reward;
        cumulative += reward;
      }

      const meanReward = cumulative / this.seedSet.length;

      if (nonFinite || !Number.isFinite(meanReward)) {
        addTag(creature, "error", "Infinity");
        addTag(creature, "trialRewards", trialRewards.join(","));
        creature.score = -Infinity;
        addTag(creature, "score", creature.score.toString());
        this.fanOutToDuplicates(creature, duplicates);
        continue;
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

      if (Number.isFinite(error)) {
        addTag(creature, "error", error.toString());
        const scoreStart = performance.now();
        creature.score = calculateScore(creature, error, this.episodicGrowth);
        scorerMsAccum += performance.now() - scoreStart;
        scoredCount++;
      } else {
        addTag(creature, "error", "Infinity");
        creature.score = -Infinity;
      }

      addTag(creature, "score", creature.score.toString());
      addTag(creature, "trialRewards", trialRewards.join(","));

      // Per-creature variance telemetry. Population-standard-deviation
      // (divisor = N) is the natural choice when the trials enumerate the
      // entire sample (no bias correction needed).
      let stdReward = 0;
      if (this.seedSet.length > 1) {
        let variance = 0;
        for (let t = 0; t < this.seedSet.length; t++) {
          const d = trialRewards[t] - meanReward;
          variance += d * d;
        }
        variance /= this.seedSet.length;
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

      this.fanOutToDuplicates(creature, duplicates);
    }

    this.lastScorerMs = scorerMsAccum;
    this.lastScoredCreatureCount = scoredCount;
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
    for (const duplicate of dupes) {
      if (duplicate === creature) continue;
      duplicate.score = creature.score;
      if (errorTag) addTag(duplicate, "error", errorTag);
      if (scoreTag) addTag(duplicate, "score", scoreTag);
      if (trialsTag) addTag(duplicate, "trialRewards", trialsTag);
    }
  }
}
