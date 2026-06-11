/**
 * TrainingOutcome.ts — Epoch state construction and per-epoch outcome.
 *
 * Issue #2399: Extracted from TrainingEpoch.ts. Owns the shared
 * {@link EpochState} shape, its initial construction from setup output,
 * and the "did this epoch improve or regress?" decision logic.
 */

import { blue, yellow } from "@std/fmt/colors";
import { ensureDirSync } from "@std/fs";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { getLogger } from "@utils/Logger.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { TrainingSetupState } from "@architecture/training/TrainingSetup.ts";
import type { ScratchIndexBuffer } from "@architecture/training/TrainingSamples.ts";

/** Mutable state carried across epochs of the training loop. */
export interface EpochState {
  bestError: number | undefined;
  previousIterationError: number | undefined;
  trainingFailures: number;
  bestCreatureJSON: CreatureExport;
  bestTraceJSON: CreatureTrace;
  knownSampleCount: number;
  sparseConfig: SparseConfig;
  scratch: ScratchIndexBuffer;
  indxMap: Map<string, Set<number>>;
  timedOut: boolean;
  timeoutTS: number;
}

/**
 * Computes the absolute timeout timestamp (epoch ms) for a training run.
 *
 * Issue #2899: the relative budget ({@link trainingTimeOutMinutes}) is
 * anchored at worker start, which drifts when the task waited in the worker
 * queue. When an absolute {@link hardDeadlineTS} is supplied it clamps the
 * relative budget so the run stops at the hard deadline regardless of queue
 * delay. A `trainingTimeOutMinutes` of `0` means "no relative budget"; an
 * absent/zero `hardDeadlineTS` leaves the relative computation unchanged.
 *
 * Pure and `now`-injectable so it can be unit-tested without elapsed-time
 * assertions (#2888 policy).
 *
 * @param now - current epoch ms (injected for deterministic testing)
 * @param trainingTimeOutMinutes - relative budget in minutes (0 = none)
 * @param hardDeadlineTS - absolute hard deadline epoch ms (0/undefined = none)
 * @returns the timeout timestamp in epoch ms, or 0 for no timeout
 */
export function computeTimeoutTS(
  now: number,
  trainingTimeOutMinutes: number,
  hardDeadlineTS?: number,
): number {
  const relativeTS = trainingTimeOutMinutes > 0
    ? now + trainingTimeOutMinutes * 60 * 1000
    : 0;
  const hardTS = hardDeadlineTS ?? 0;
  if (hardTS > 0) {
    return relativeTS > 0 ? Math.min(relativeTS, hardTS) : hardTS;
  }
  return relativeTS;
}

/** Construct the initial epoch state from setup output. */
export function createEpochState(setup: TrainingSetupState): EpochState {
  return {
    bestError: undefined,
    previousIterationError: undefined,
    trainingFailures: 0,
    bestCreatureJSON: setup.bestCreatureJSON,
    bestTraceJSON: setup.bestTraceJSON,
    knownSampleCount: -1,
    sparseConfig: setup.sparseConfig,
    scratch: { buffer: null },
    indxMap: new Map(),
    timedOut: false,
    timeoutTS: computeTimeoutTS(
      Date.now(),
      setup.trainingTimeOutMinutes,
      setup.hardDeadlineTS,
    ),
  };
}

/**
 * Apply the outcome of an epoch: either revert to the best creature
 * (when error got worse) or record the new best state and rebuild
 * sparse config from fresh neuron-error data.
 */
export function applyEpochOutcome(
  creature: Creature,
  options: TrainOptions,
  setup: TrainingSetupState,
  state: EpochState,
  error: number,
  iteration: number,
  trainingStopped: boolean,
): void {
  // Issue #1388: Track error history for adaptive learning rate feedback.
  state.previousIterationError = state.bestError;

  if (state.bestError !== undefined && state.bestError < error) {
    state.trainingFailures++;
    if (!trainingStopped) {
      getLogger().warn(
        `Training ${blue(setup.ID)} made the error: ${
          yellow(state.bestError.toFixed(3))
        }, worse: ${yellow(error.toFixed(3))}, target: ${
          yellow(setup.targetError.toString())
        }, failed: ${yellow(state.trainingFailures.toString())} out of ${
          yellow(iteration.toString())
        } iterations`,
      );
    }
    if (options.traceStore) {
      const failedDir = `${options.traceStore}/failed`;
      ensureDirSync(failedDir);
      CreatureUtil.makeUUID(creature);
      Deno.writeTextFileSync(
        `${failedDir}/${creature.uuid}.json`,
        JSON.stringify(creature.traceJSON()),
      );
    }
    creature.loadFrom(state.bestCreatureJSON, false, "training:outcomeRestore");
    return;
  }

  // Issue #1388: Collect neuron error data before clearing state.
  // Issue #1540: Skip collection entirely when sparseRatio === 1.
  const neuronErrors = setup.backPropConfig.sparseRatio < 1
    ? creature.state.collectNeuronErrors()
    : undefined;

  const lastTraceJSON = creature.traceJSON();
  if (state.bestError === undefined || state.bestError > error) {
    state.bestTraceJSON = lastTraceJSON;
  }
  state.bestCreatureJSON = exportJSONWithRuntimeIds(creature);
  state.bestError = error;

  creature.applyLearnings(setup.iterationConfig, state.sparseConfig);
  creature.clearState();

  // Issue #1388: Rebuild sparse config with error-guided neuron
  // selection when sparse training is active and we have error data.
  if (neuronErrors && neuronErrors.size > 0) {
    state.sparseConfig = new SparseConfig(
      state.bestCreatureJSON,
      setup.backPropConfig,
      setup.outgoingSynapsesMap,
      neuronErrors,
    );
  }
}
