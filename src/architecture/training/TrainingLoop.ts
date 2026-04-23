/**
 * TrainingLoop.ts — Outer training loop.
 *
 * Issue #2399: Drives the epoch counter, learning rate scheduling, and
 * termination conditions. Per-epoch bookkeeping lives in
 * `TrainingEpoch.ts`; data-augmentation and sample-index selection live
 * in `TrainingSamples.ts`. This file is intentionally small — it is the
 * orchestrator for the iteration phase.
 */

import { blue, yellow } from "@std/fmt/colors";
import type { CostInterface } from "@costs/CostInterface.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  calculateLearningRate,
  type ErrorFeedback,
} from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import {
  fp,
  type TrainingSetupState,
} from "@architecture/training/TrainingSetup.ts";
import { runSingleEpoch } from "@architecture/training/TrainingEpoch.ts";
import {
  applyEpochOutcome,
  createEpochState,
} from "@architecture/training/TrainingOutcome.ts";

/**
 * Outcome of the training loop, ready to be handed to the teardown phase.
 */
export interface TrainingLoopResult {
  iteration: number;
  bestError: number;
  bestCreatureJSON: CreatureExport;
  bestTraceJSON: CreatureTrace;
  sparseConfig: SparseConfig;
  timedOut: boolean;
}

/**
 * Executes the main training loop over the provided binary files.
 */
export function runTrainingLoop(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): TrainingLoopResult {
  const { backPropConfig, iterationConfig, targetError, iterations, ID } =
    setup;

  if (options.log) {
    getLogger().info(
      `Training ${blue(ID)} with ${binaryFiles.length} binary file${
        binaryFiles.length > 1 ? "s" : ""
      }, target error: ${yellow(targetError.toString())}, iterations: ${
        yellow(iterations.toString())
      }, sample rate: ${fp(setup.trainingSampleRate)}, sparse: ${
        fp(backPropConfig.sparseRatio)
      }`,
    );
  }

  const state = createEpochState(setup);
  let iteration = 0;

  while (true) {
    // Issue #1388: Pass error feedback to the adaptive learning rate strategy.
    const errorFeedback: ErrorFeedback | undefined =
      state.previousIterationError !== undefined &&
        state.bestError !== undefined
        ? {
          previousError: state.previousIterationError,
          currentError: state.bestError,
        }
        : undefined;

    iterationConfig.learningRate = calculateLearningRate(
      backPropConfig,
      iteration,
      errorFeedback,
    );

    iteration++;
    // Issue #1540: Mutate in place instead of creating a frozen copy.
    iterationConfig.generations = backPropConfig.generations + iteration;

    const { errorSum, counter, trainingStopped } = runSingleEpoch(
      creature,
      binaryFiles,
      options,
      cost,
      setup,
      state,
    );

    if (counter === 0) {
      throw new ValidationError(
        `Training ${blue(ID)} stopped as no samples were processed`,
        "OTHER",
      );
    }

    const error = errorSum / counter;

    applyEpochOutcome(
      creature,
      options,
      setup,
      state,
      error,
      iteration,
      trainingStopped,
    );

    if (
      state.timedOut || state.bestError! <= targetError ||
      iteration >= iterations
    ) {
      return {
        iteration,
        bestError: state.bestError!,
        bestCreatureJSON: state.bestCreatureJSON,
        bestTraceJSON: state.bestTraceJSON,
        sparseConfig: state.sparseConfig,
        timedOut: state.timedOut,
      };
    }
  }
}
