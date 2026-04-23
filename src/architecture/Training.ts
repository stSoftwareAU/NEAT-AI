/**
 * Training.ts — Public training entry points.
 *
 * Issue #2399: This file used to contain 784 lines mixing pre-training
 * setup, the training loop, and post-training teardown. Those phases
 * now live under `src/architecture/training/` and this module is a thin
 * orchestrator that composes them and re-exports the public helpers.
 */

import { assert } from "@std/assert";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { trainWithCrossValidation } from "@architecture/CrossValidationTrainer.ts";
import {
  dataFiles,
  prepareTraining,
} from "@architecture/training/TrainingSetup.ts";
import { runTrainingLoop } from "@architecture/training/TrainingLoop.ts";
import { finaliseTraining } from "@architecture/training/TrainingTeardown.ts";
import { trainDirPredictiveCoding } from "@architecture/training/TrainingPredictiveCoding.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";

export { dataFiles } from "@architecture/training/TrainingSetup.ts";
export type { TrainingResult } from "@architecture/training/TrainingTypes.ts";

/**
 * Trains a creature using data from a directory.
 *
 * This function trains a neural network creature using binary training data
 * stored in the specified directory. It handles file discovery, batch
 * processing, and training iteration management.
 *
 * @param creature - The creature to train
 * @param dataDir - Directory containing binary training data files
 * @param options - Training configuration options
 * @returns Training result with error metrics and trace data
 * @throws {Error} When no training files are found in the directory
 */
export function trainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
): TrainingResult {
  const dataResult = dataFiles(dataDir, options);

  assert(
    dataResult.files.length > 0,
    "No binary files found in the data directory",
  );

  // Issue #1556: Delegate to Predictive Coding trainer when enabled.
  if (options.predictiveCoding?.enabled) {
    return trainDirPredictiveCoding(
      creature,
      dataResult.files,
      options,
      cost,
    );
  }

  // Issue #1865: Delegate to cross-validation trainer when enabled.
  if (options.crossValidation?.enabled) {
    const folds = options.crossValidation.folds ?? 5;
    const validationEarlyStopping =
      options.crossValidation.validationEarlyStopping ?? true;
    return trainWithCrossValidation(
      creature,
      dataDir,
      options,
      cost,
      folds,
      validationEarlyStopping,
    );
  }

  return trainDirBinary(creature, dataResult.files, options, cost);
}

/**
 * Trains a creature on a single data directory (no cross-validation).
 *
 * Issue #1865: Exposed as a named export so CrossValidationTrainer
 * can call it for each fold without recursion.
 */
export function trainDirSingleFold(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
): TrainingResult {
  const dataResult = dataFiles(dataDir, options);

  assert(
    dataResult.files.length > 0,
    "No binary files found in the data directory",
  );

  return trainDirBinary(creature, dataResult.files, options, cost);
}

/**
 * Orchestrates the three training phases for a single-fold binary run:
 * setup → loop → teardown.
 */
function trainDirBinary(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
  cost: CostInterface,
): TrainingResult {
  const uuid = CreatureUtil.makeUUID(creature);
  const ID = uuid.substring(Math.max(0, uuid.length - 8));

  const setup = prepareTraining(creature, options, ID);

  const loopResult = runTrainingLoop(
    creature,
    binaryFiles,
    options,
    cost,
    setup,
  );

  return finaliseTraining(
    creature,
    loopResult,
    setup.iterationConfig,
    setup.iterations,
    setup.feedbackLoop,
    setup.syntheticKeys,
    setup.ID,
  );
}
