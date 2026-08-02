/**
 * EvolveGenerationTail.ts — the end-of-generation bookkeeping shared by
 * `evolveDir`, `evolveEnv`, and `evolveRL` (Issue #3636).
 *
 * Every training loop in `CreatureTraining.ts` ends a generation the same way:
 * adopt the champion when it improved, optionally write a timed checkpoint,
 * fold the generation's phase timings and scorer-utilisation counts into the
 * run totals, snapshot the score trajectory, emit `generation_complete` (plus
 * `plateau_detected` on a plateau), and decide whether the run is finished.
 *
 * That sequence used to be copy-pasted three times, so every change to the
 * rule — a new `generation_complete` field, a different early-stop comparator —
 * had to land identically in three places (#3210, #3234, #3422, #3402, #3263,
 * #2947 each did). The copies had already drifted. {@link finishGeneration} is
 * the single home for the rule; genuinely variant-specific work (evolveDir's
 * score/error consistency assert, evolveRL's milestone capture) stays in the
 * caller's loop.
 */

import { assert } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { GenerationPhaseTiming } from "@config/TrainingEvent.ts";
import type { EvolveResult as GenerationEvolveResult } from "@neat/NeatEvolution.ts";
import {
  isBetterChampion,
  shouldEarlyStop,
} from "@costs/CostAwareEarlyStop.ts";
import {
  type CheckpointSource,
  writeCreatures,
} from "@creature/CheckpointWriter.ts";
import { adoptChampionClone } from "@creature/EvolveTeardown.ts";
import {
  accumulatePhaseTiming,
  type PhaseTimingAccumulator,
} from "@creature/PhaseTimingTotals.ts";
import {
  accumulateScorerUtilisation,
  type ScorerUtilisationAccumulator,
  type ScorerUtilisationCounts,
} from "@creature/ScorerUtilisationTotals.ts";
import {
  recordScoreImprovement,
  type ScoreTrajectory,
} from "@creature/ScoreImprovementMilestones.ts";
import { buildWarmupEventFields } from "@architecture/CreatureFactory.ts";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";

/**
 * The per-generation scorer counters published by `Fitness` — satisfied by
 * both the dataset `Fitness` and the episodic/RL scorers (Issue #3234).
 */
export interface ScorerUtilisationSource {
  readonly lastBatchScorerInvocations: number;
  readonly lastCreaturesBatchScored: number;
  readonly lastCreaturesPerCreatureScored: number;
  readonly lastBatchFallbackOccurred: boolean;
}

/**
 * The `Neat` state the generation tail reads — satisfied by `Neat` itself.
 * Structural (rather than a `Neat` import) so the helper stays directly
 * testable and free of the `Neat` → `Creature` → `CreatureTraining` cycle.
 */
export interface GenerationTailSource extends CheckpointSource {
  readonly fitness: ScorerUtilisationSource;
}

/** Everything the shared tail needs from one generation of a training loop. */
export interface GenerationTailContext {
  readonly neat: GenerationTailSource;
  readonly config: NeatConfig;
  /** This generation's `neat.evolve()` result. */
  readonly result: GenerationEvolveResult;
  /** Generation number, already incremented for this cycle. */
  readonly generation: number;
  /** Run start timestamp in ms. */
  readonly start: number;
  /** Timestamp the previous logged generation finished, in ms. */
  readonly iterationStartMS: number;
  /** Soft deadline in ms; `0` when no timeout is configured. */
  readonly endTimeMS: number;
  /** True once SIGTERM / an abort signal has been observed. */
  readonly interrupted: boolean;
  /** Best score seen so far across the run. */
  readonly bestScore: number;
  /** Error of the current champion; `Infinity` before the first champion. */
  readonly error: number;
  /** Current champion clone, or `undefined` before the first champion. */
  readonly bestCreature: Creature | undefined;
  readonly phaseTimingAccumulator: PhaseTimingAccumulator;
  readonly scorerUtilisationAccumulator: ScorerUtilisationAccumulator;
  readonly scoreTrajectory: ScoreTrajectory;
}

/** The loop state {@link finishGeneration} hands back to its caller. */
export interface GenerationTailOutcome {
  /** Champion clone after this generation (unchanged when no improvement). */
  readonly bestCreature: Creature | undefined;
  /** Best score after this generation. */
  readonly bestScore: number;
  /** Champion error after this generation. */
  readonly error: number;
  /** True when this generation produced a new champion. */
  readonly championImproved: boolean;
  /** Timestamp taken once, after champion adoption. */
  readonly now: number;
  /** True when the soft deadline has passed. */
  readonly timedOut: boolean;
  /** This generation's phase timing, including any checkpoint write. */
  readonly phaseTiming: GenerationPhaseTiming;
  /** True when the cost-aware early-stop threshold was met. */
  readonly earlyStop: boolean;
  /** True when the run should finish after this generation. */
  readonly completed: boolean;
}

/**
 * Snapshot the per-backend scorer-utilisation counts published by the scorer
 * after a generation's `evolve()` cycle (Issue #3234).
 */
function readScorerUtilisation(
  fitness: ScorerUtilisationSource,
): ScorerUtilisationCounts {
  return {
    batchScorerInvocations: fitness.lastBatchScorerInvocations,
    creaturesBatchScored: fitness.lastCreaturesBatchScored,
    creaturesPerCreatureScored: fitness.lastCreaturesPerCreatureScored,
    batchFallbackOccurred: fitness.lastBatchFallbackOccurred,
  };
}

/**
 * Run the end-of-generation bookkeeping shared by every training loop.
 *
 * @param ctx This generation's loop state.
 * @returns The updated champion state plus the stop decision for the loop.
 */
export async function finishGeneration(
  ctx: GenerationTailContext,
): Promise<GenerationTailOutcome> {
  const { config, neat, result, generation } = ctx;

  const fittest = result.fittest;
  const fittestScore = fittest.score!;
  assert(fittestScore >= ctx.bestScore, "Score is less than best score");

  let error = ctx.error;
  let bestScore = ctx.bestScore;
  let bestCreature = ctx.bestCreature;
  let championImproved = false;

  // Issue #2787: route champion comparison through the cost-aware helper.
  // Today this remains a strict `score > bestScore` for every cost (NaN-safe)
  // so existing runs do not regress; the seam is in place for future
  // cost-specific tie-breaks.
  if (isBetterChampion(fittestScore, bestScore, config.costName)) {
    const errorTmp = getTag(fittest, "error");
    assert(errorTmp, "No error tag found");

    const parsedError = errorTmp === "Infinity"
      ? Number.POSITIVE_INFINITY
      : Number.parseFloat(errorTmp);
    assert(Number.isFinite(parsedError), "Error is not finite");
    assert(parsedError >= 0, "Error is negative");
    error = parsedError;
    bestScore = fittestScore;
    // Issue #3434: dispose the superseded champion clone before overwriting it
    // so its topology arrays / WASM activation are released immediately.
    bestCreature = adoptChampionClone(bestCreature, fittest, bestScore);
    championImproved = true;
  }

  const now = Date.now();
  const timedOut = ctx.endTimeMS ? now > ctx.endTimeMS : false;

  // Issue #2251: Time the checkpoint write so it flows through onTrainingEvent.
  // Issue #2275: Async checkpoint writes unblock the event loop.
  let phaseTiming = result.phaseTiming;
  if (config.checkpointEveryGeneration && config.creatureStore) {
    const checkpointStart = Date.now();
    await writeCreatures(neat, config.creatureStore);
    phaseTiming = {
      ...result.phaseTiming,
      checkpointWriteMs: Date.now() - checkpointStart,
    };
  }

  // Issue #3210: fold this generation's (checkpoint-merged) phase timing into
  // the whole-run running totals returned alongside `time`.
  accumulatePhaseTiming(ctx.phaseTimingAccumulator, phaseTiming);
  // Issue #3234: fold this generation's per-backend scorer-utilisation counts
  // into the whole-run totals returned alongside `phaseTimingTotals`.
  accumulateScorerUtilisation(
    ctx.scorerUtilisationAccumulator,
    readScorerUtilisation(neat.fitness),
  );

  // Issue #3422: on a champion improvement, snapshot the best-score curve with
  // the now-current cumulative scored-count so the milestone summary can be
  // derived at run end without persisting a per-generation series.
  if (championImproved) {
    recordScoreImprovement(ctx.scoreTrajectory, {
      score: bestScore,
      generation,
      timeMs: now - ctx.start,
      scoredCount: ctx.scorerUtilisationAccumulator.creaturesBatchScored +
        ctx.scorerUtilisationAccumulator.creaturesPerCreatureScored,
    });
  }

  // Issue #1615: Emit generation_complete event.
  // Issue #2239: Include per-phase timing diagnostics from evolve().
  // Issue #2330: Forward compact throughput counters (wall-clock, queue
  // depths, approximate worker wait) on the same event.
  const generationElapsedMs = now -
    (generation === 1 ? ctx.start : ctx.iterationStartMS);
  emitTrainingEvent(config.onTrainingEvent, {
    kind: "generation_complete",
    timestamp: Temporal.Now.instant().toString(),
    generation,
    bestFitness: fittestScore,
    averageFitness: result.averageScore,
    populationSize: neat.population.length,
    // Issue #3402: population topology averages for memory-profile diagnosis.
    averageNeurons: result.topologyAverages.averageNeurons,
    averageSynapses: result.topologyAverages.averageSynapses,
    elapsedMs: generationElapsedMs,
    phaseTiming,
    throughput: result.throughput,
    // Issue #3263: diagnostic squash mix for the squash-budget experiment.
    squashHistogram: result.squashHistogram,
    // Issue #2947: surface the lineage-accumulated warm-up counter and the
    // derived lock state (present only while warm-up is configured).
    ...buildWarmupEventFields(neat.warmupGenerations, neat.currentGeneration),
  });

  // Issue #1615: Emit plateau_detected event when on plateau.
  if (result.plateau.onPlateau) {
    emitTrainingEvent(config.onTrainingEvent, {
      kind: "plateau_detected",
      timestamp: Temporal.Now.instant().toString(),
      generation,
      stagnationCount: result.plateau.generationsOnPlateau,
      plateauThreshold: config.plateauDetection.windowSize,
      improvementRate: result.plateau.improvementRate,
      mutationMultiplier: result.plateau.mutationMultiplier,
    });
  }

  // Issue #2787: cost-aware early-stop. For built-in costs the threshold is
  // clamped into the cost's natural range (e.g. unit-range CROSS_ENTROPY
  // clamped to [0, 1] vs unbounded MSE); custom JS costs fall back to the
  // legacy `error <= targetError` comparator as a regression guard.
  const earlyStop = shouldEarlyStop(error, config.targetError, config.costName);
  const completed = ctx.interrupted || timedOut || earlyStop ||
    generation >= config.iterations;

  return {
    bestCreature,
    bestScore,
    error,
    championImproved,
    now,
    timedOut,
    phaseTiming,
    earlyStop,
    completed,
  };
}
