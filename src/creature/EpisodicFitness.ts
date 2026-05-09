/**
 * EpisodicFitness.ts — In-process episode-rollout scorer for
 * `Creature.evolveEnv()` (Issue #2611).
 *
 * Drop-in replacement for {@link Fitness}: same `calculate()` signature and
 * the same telemetry counters consumed by `NeatEvolution.ts`. Replaces the
 * worker-based dataset evaluation with N-trial episode rollouts driven by an
 * {@link EpisodeAdapter}. Multi-threaded rollouts are deliberately deferred to
 * a follow-up so the implementation reviewable; today every episode runs on
 * the main thread.
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
import type {
  EpisodeAdapter,
  EpisodeTrialsEvent,
} from "@creature/EpisodeAdapter.ts";

/**
 * Constructor dependencies for {@link EpisodicFitness}. Mirrors the
 * caller-tunable surface of `EpisodicOptions` plus the `growth` cost factor
 * pulled from {@link NeatConfig}.
 */
export interface EpisodicFitnessDeps<S, A> {
  readonly adapter: EpisodeAdapter<S, A>;
  readonly growth: number;
  readonly trialsPerScore: number;
  readonly initialPerturbation: number;
  readonly baseSeed: number;
  readonly rewardToError: (reward: number) => number;
  readonly onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;
}

/**
 * Fitness scorer that runs episode rollouts inline instead of dispatching
 * dataset evaluations to worker threads.
 *
 * Extends {@link Fitness} so it satisfies the structural contract used by
 * `Neat`/`NeatEvolution.ts` (the `readonly fitness` slot, the
 * `lastQueueMaxDepth`/`lastScorerMs`/`lastScoredCreatureCount` telemetry, and
 * `setDataDir()`). The base constructor is invoked with an empty worker pool;
 * `calculate()` is fully overridden and never dispatches to those workers.
 */
export class EpisodicFitness<S, A> extends Fitness {
  private readonly adapter: EpisodeAdapter<S, A>;
  private readonly episodicGrowth: number;
  private readonly trialsPerScore: number;
  private readonly initialPerturbation: number;
  private readonly baseSeed: number;
  private readonly rewardToError: (reward: number) => number;
  private readonly onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;

  /** 1-based generation counter used in {@link EpisodeTrialsEvent.generation}. */
  private generation = 0;

  constructor(deps: EpisodicFitnessDeps<S, A>) {
    // Empty worker pool: the base class is only here for the structural
    // contract; episode rollouts run on the main thread.
    super([], deps.growth, false);
    this.adapter = deps.adapter;
    this.episodicGrowth = deps.growth;
    this.trialsPerScore = deps.trialsPerScore;
    this.initialPerturbation = deps.initialPerturbation;
    this.baseSeed = deps.baseSeed;
    this.rewardToError = deps.rewardToError;
    this.onEpisodeTrials = deps.onEpisodeTrials;
  }

  /**
   * Bump the generation counter. Called from `Creature.evolveEnv()` after each
   * `neat.evolve()` so the next fitness phase emits the correct generation
   * number on per-creature trial events.
   */
  setGeneration(generation: number): void {
    this.generation = generation;
  }

  /**
   * Score every creature in `population` whose `creature.score` is undefined.
   *
   * Mirrors {@link Fitness.calculate} semantics: deduplicates by UUID, scores
   * each unique creature once, then fans the score and tags out to duplicates.
   * The `additionalWorkers` argument is accepted for API parity but ignored —
   * episode rollouts run inline.
   */
  override calculate(
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

    const needsEvaluation = population.filter((c) => c.score === undefined);

    // Deduplicate by UUID so that two pointers to the same genome cost a
    // single rollout. The duplicate fan-out at the end of the loop mirrors
    // the dataset path so downstream code that relies on `score`/`error`
    // tags being present on every creature still works.
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

    if (uniqueQueue.length === 0) return Promise.resolve();

    this.lastQueueMaxDepth = uniqueQueue.length;

    let scorerMsAccum = 0;
    let scoredCount = 0;

    for (const creature of uniqueQueue) {
      if (creature.input !== this.adapter.inputCount) {
        throw new ValidationError(
          `Creature input ${creature.input} does not match adapter ` +
            `inputCount ${this.adapter.inputCount}`,
          "OTHER",
        );
      }
      if (creature.output !== this.adapter.outputCount) {
        throw new ValidationError(
          `Creature output ${creature.output} does not match adapter ` +
            `outputCount ${this.adapter.outputCount}`,
          "OTHER",
        );
      }

      const trialRewards: number[] = new Array(this.trialsPerScore);
      let cumulative = 0;
      let nonFinite = false;

      for (let t = 0; t < this.trialsPerScore; t++) {
        // Per-trial seed derivation: deterministic from baseSeed + trial
        // index, optionally perturbed. Using bit-mixing keeps adjacent trials
        // far apart in the seed space so adapters that key off the seed do
        // not see correlated trials.
        const perturbation = this.initialPerturbation > 0
          ? Math.round(t * this.initialPerturbation * 1_000_003)
          : 0;
        const trialSeed = (this.baseSeed + t * 1_000_003 + perturbation) >>> 0;

        let reward: number;
        try {
          reward = this.runEpisode(creature, trialSeed);
        } catch (err) {
          if (err instanceof ActivationError) {
            getLogger().warn(
              `[EpisodicFitness] Activation failure on creature ` +
                `${creature.uuid?.substring(0, 8) ?? "unknown"}: ` +
                `${err.message}`,
            );
            reward = -Infinity;
          } else {
            throw err;
          }
        }

        if (!Number.isFinite(reward)) nonFinite = true;
        trialRewards[t] = reward;
        cumulative += reward;
      }

      const meanReward = cumulative / this.trialsPerScore;

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
        // Fail safe: a misbehaving rewardToError should not corrupt the
        // population. Treat as worst-case so natural selection drops the
        // creature instead of crashing the run.
        getLogger().warn(
          `[EpisodicFitness] rewardToError returned non-positive-finite ` +
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
      if (this.trialsPerScore > 1) {
        let variance = 0;
        for (let t = 0; t < this.trialsPerScore; t++) {
          const d = trialRewards[t] - meanReward;
          variance += d * d;
        }
        variance /= this.trialsPerScore;
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
    return Promise.resolve();
  }

  /**
   * Run a single episode for `creature` using `seed`. Returns the cumulative
   * reward across the rollout (capped at `adapter.maxSteps`).
   */
  private runEpisode(creature: Creature, seed: number): number {
    let state: S = this.adapter.reset(seed);
    let cumulative = 0;

    for (let step = 0; step < this.adapter.maxSteps; step++) {
      const observation = this.adapter.observe(state);
      if (observation.length !== this.adapter.inputCount) {
        throw new ValidationError(
          `Adapter.observe() returned ${observation.length} values, expected ` +
            `${this.adapter.inputCount}`,
          "OTHER",
        );
      }

      // Recurrent topologies are explicitly disabled in the activate call;
      // creature.activate() honours forwardOnly so this is a no-op for
      // forward-only creatures and just disables feedback for recurrent ones.
      const output = creature.activate(observation, false);
      const action = this.adapter.decode(output);
      const result = this.adapter.step(state, action);

      if (!Number.isFinite(result.reward)) return Number.NEGATIVE_INFINITY;

      cumulative += result.reward;
      state = result.state;

      if (result.done) break;
    }

    return cumulative;
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

/** Re-exported helper so `evolveEnv` callers can build dependencies cleanly. */
export { defaultRewardToError } from "@creature/EpisodeAdapter.ts";
