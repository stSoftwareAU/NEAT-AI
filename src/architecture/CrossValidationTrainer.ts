/**
 * CrossValidationTrainer.ts - K-fold cross-validation training.
 *
 * Issue #1865: Wraps the standard training pipeline to evaluate
 * creatures using k-fold cross-validation. Each fold trains on k-1
 * portions and validates on the held-out portion, producing a more
 * robust fitness estimate that reduces overfitting.
 */

import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { Creature } from "@creature";
import { getLogger } from "@utils/Logger.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  cleanupFoldSplits,
  createKFoldSplits,
  type FoldSplit,
} from "@architecture/KFoldSplitter.ts";
import { trainDirSingleFold } from "@architecture/Training.ts";

/**
 * Result from cross-validation training.
 */
interface CrossValidationResult {
  /** Short creature identifier. */
  ID: string;
  /** Number of training iterations completed (from best fold). */
  iteration: number;
  /** Average validation error across all folds. */
  error: number;
  /** Trace from the best-performing fold. */
  trace: ReturnType<Creature["traceJSON"]>;
  /** Compact export from the best-performing fold. */
  compact: ReturnType<Creature["exportJSON"]> | undefined;
}

/**
 * Evaluates the validation error of a creature on a set of binary files.
 *
 * @param creature - The trained creature to evaluate
 * @param validationDir - Directory with validation data
 * @param cost - Cost function to use
 * @returns Average validation error
 */
function evaluateValidation(
  creature: Creature,
  validationDir: string,
  cost: CostInterface,
): number {
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
  const observationsBuffer = new Float32Array(creature.input);
  const targetsBuffer = new Float32Array(creature.output);

  let errorSum = 0;
  let counter = 0;

  for (const dirEntry of Deno.readDirSync(validationDir)) {
    if (!dirEntry.isFile || !dirEntry.name.endsWith(".bin")) continue;

    const filePath = `${validationDir}/${dirEntry.name}`;
    const fileData = Deno.readFileSync(filePath);
    const recordCount = Math.floor(fileData.byteLength / BYTES_PER_RECORD);
    const dataView = new Float32Array(fileData.buffer);

    for (let i = 0; i < recordCount; i++) {
      const offset = i * valuesCount;
      observationsBuffer.set(
        dataView.subarray(offset, offset + creature.input),
      );
      targetsBuffer.set(
        dataView.subarray(offset + creature.input, offset + valuesCount),
      );

      const output = creature.activate(observationsBuffer);
      const sampleError = cost.calculate(targetsBuffer, output);
      assert(
        Number.isFinite(sampleError),
        "Validation sample error is not finite",
      );
      errorSum += sampleError;
      counter++;
    }
  }

  if (counter === 0) return Infinity;
  return errorSum / counter;
}

/**
 * Trains a creature using k-fold cross-validation.
 *
 * For each fold:
 * 1. Clone the creature
 * 2. Train the clone on the training portion
 * 3. Evaluate on the held-out validation portion
 *
 * The final error is the average validation error across all folds.
 * The creature is loaded from the fold that achieved the best
 * validation error.
 *
 * @param creature - The creature to train
 * @param dataDir - Directory containing binary training data
 * @param options - Training configuration options
 * @param cost - Cost function
 * @param inputCount - Number of input values per record
 * @param outputCount - Number of output values per record
 * @param folds - Number of folds (k)
 * @param useValidationEarlyStopping - Use validation error for early stopping
 * @returns Cross-validation training result
 */
export function trainWithCrossValidation(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
  folds: number,
  useValidationEarlyStopping: boolean,
): CrossValidationResult {
  const uuid = CreatureUtil.makeUUID(creature);
  const ID = uuid.substring(Math.max(0, uuid.length - 8));

  const partitionBreak = options.batchSize ?? 2000;

  let splits: FoldSplit[];
  try {
    splits = createKFoldSplits(
      dataDir,
      creature.input,
      creature.output,
      folds,
      partitionBreak,
    );
  } catch (e) {
    // Fall back to single-split if not enough data for k folds
    getLogger().warn(
      `Cross-validation ${blue(ID)}: falling back to single-split: ${e}`,
    );
    return trainDirSingleFold(creature, dataDir, options, cost);
  }

  if (options.log) {
    getLogger().info(
      `Cross-validation ${blue(ID)}: ${yellow(String(folds))} folds, ` +
        `validation early stopping: ${
          yellow(String(useValidationEarlyStopping))
        }`,
    );
  }

  const creatureJSON = creature.exportJSON();
  let bestValidationError = Infinity;
  let bestFoldResult: ReturnType<typeof trainDirSingleFold> | undefined;
  let bestFoldCreatureJSON: ReturnType<Creature["exportJSON"]> | undefined;
  let totalValidationError = 0;
  let completedFolds = 0;

  // Cross-validation options: disable early stopping based on training
  // error when using validation-based early stopping
  const cvOptions: TrainOptions = {
    ...options,
    // Remove cross-validation from sub-options to prevent recursion
    crossValidation: undefined,
  };

  try {
    for (let foldIndex = 0; foldIndex < splits.length; foldIndex++) {
      const split = splits[foldIndex];

      // Clone the creature for this fold
      const foldCreature = Creature.fromJSON(creatureJSON);

      // Train on the training portion
      const foldResult = trainDirSingleFold(
        foldCreature,
        split.trainDir,
        cvOptions,
        cost,
      );

      // Evaluate on the validation portion
      let validationError: number;
      if (useValidationEarlyStopping) {
        validationError = evaluateValidation(
          foldCreature,
          split.validationDir,
          cost,
        );
      } else {
        validationError = foldResult.error;
      }

      totalValidationError += validationError;
      completedFolds++;

      if (options.log) {
        getLogger().info(
          `Cross-validation ${blue(ID)} fold ${yellow(String(foldIndex + 1))}/${
            yellow(String(folds))
          }: ` +
            `train error=${yellow(foldResult.error.toFixed(4))}, ` +
            `validation error=${yellow(validationError.toFixed(4))}`,
        );
      }

      if (validationError < bestValidationError) {
        bestValidationError = validationError;
        bestFoldResult = foldResult;
        bestFoldCreatureJSON = foldCreature.exportJSON();
      }
    }
  } finally {
    cleanupFoldSplits(splits, dataDir);
  }

  const averageError = completedFolds > 0
    ? totalValidationError / completedFolds
    : Infinity;

  // Load the best-performing fold's weights into the original creature
  if (bestFoldCreatureJSON) {
    creature.loadFrom(bestFoldCreatureJSON, false, "training:crossValidation");
  }

  if (options.log) {
    getLogger().info(
      `Cross-validation ${blue(ID)} complete: average error=${
        yellow(averageError.toFixed(4))
      }, best fold error=${yellow(bestValidationError.toFixed(4))}`,
    );
  }

  return {
    ID,
    iteration: bestFoldResult?.iteration ?? 0,
    error: averageError,
    trace: bestFoldResult?.trace ?? creature.traceJSON(),
    compact: bestFoldResult?.compact,
  };
}
