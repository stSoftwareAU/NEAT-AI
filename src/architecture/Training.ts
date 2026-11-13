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
import {
  dataFiles,
  prepareTraining,
} from "@architecture/training/TrainingSetup.ts";
import { runTrainingLoop } from "@architecture/training/TrainingLoop.ts";
import { finaliseTraining } from "@architecture/training/TrainingTeardown.ts";
import {
  isRustTrainDirEnabled,
  runLegacyTrainDirWrappers,
  rustTrainDirSkipReason,
  tryRustTrainDir,
  tryRustTrainDirAsync,
} from "@architecture/training/RustTrainDirBridge.ts";
import { trainDirPredictiveCoding } from "@architecture/training/TrainingPredictiveCoding.ts";
import {
  reportTrainDirBackend,
} from "@architecture/training/TrainDirBackendReport.ts";
import type { TrainingSetupState } from "@architecture/training/TrainingSetup.ts";
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
  assertDataFiles(dataResult.files);

  // Issue #1556: Predictive coding is a separate TypeScript trainer —
  // the old WASM backprop never honoured it, so do not spawn Rust.
  if (options.predictiveCoding?.enabled) {
    return runPredictiveCoding(creature, dataResult.files, options, cost);
  }

  const prepared = prepareBinaryRun(
    creature,
    dataResult.files,
    options,
    cost,
  );
  if (prepared.skipRust) {
    return runLegacyTrainDirWrappers(prepared.runTypeScriptLoop);
  }

  const rust = tryRustTrainDir(
    creature,
    dataDir,
    options,
    cost,
    prepared.setup,
  );
  return resolveRustOutcome(rust, prepared.runTypeScriptLoop);
}

/**
 * Worker path (Issue #4126): same behaviour as {@link trainDir}, but the
 * native trainer is awaited rather than called synchronously. A terminated
 * worker therefore is not stuck in a blocking native call, and cannot keep
 * the process alive. The TypeScript / WASM loop stays synchronous.
 */
export async function trainDirAsync(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
): Promise<TrainingResult> {
  const dataResult = dataFiles(dataDir, options);
  assertDataFiles(dataResult.files);

  if (options.predictiveCoding?.enabled) {
    return runPredictiveCoding(creature, dataResult.files, options, cost);
  }

  const prepared = prepareBinaryRun(
    creature,
    dataResult.files,
    options,
    cost,
  );
  if (prepared.skipRust) {
    return runLegacyTrainDirWrappers(prepared.runTypeScriptLoop);
  }

  const rust = await tryRustTrainDirAsync(
    creature,
    dataDir,
    options,
    cost,
    prepared.setup,
  );
  return resolveRustOutcome(rust, prepared.runTypeScriptLoop);
}

function assertDataFiles(files: string[]): void {
  assert(files.length > 0, "No binary files found in the data directory");
}

function runPredictiveCoding(
  creature: Creature,
  files: string[],
  options: TrainOptions,
  cost: CostInterface,
): TrainingResult {
  return runLegacyTrainDirWrappers(() =>
    trainDirPredictiveCoding(creature, files, options, cost)
  );
}

/**
 * Setup for a single-fold binary run (setup → loop → teardown).
 *
 * Eligible `trainDir` uses sibling `neat_ai_backpropagation train` by
 * default. Set `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript /
 * WASM loop. `./quality.sh --next` builds the binary and sets `=1`.
 * Options the old WASM backprop never honoured stay on the TypeScript
 * loop. A missing binary is an error when Rust is enabled — no silent
 * WASM fallback.
 */
function prepareBinaryRun(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
  cost: CostInterface,
): {
  setup: TrainingSetupState;
  skipRust: boolean;
  runTypeScriptLoop: () => TrainingResult;
} {
  const uuid = CreatureUtil.makeUUID(creature);
  const ID = uuid.substring(Math.max(0, uuid.length - 8));

  const setup = prepareTraining(creature, options, ID);

  const runTypeScriptLoop = (): TrainingResult => {
    // Issue #4146: one backend line per task, before the loop runs.
    reportTrainDirBackend(setup.ID, {
      backend: "wasm",
      deadlineSent: false,
      capability: "none",
    });
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
  };

  return {
    setup,
    skipRust: rustTrainDirSkipReason(creature, options, cost, setup) !==
      undefined,
    runTypeScriptLoop,
  };
}

/** The Rust result, else the TypeScript loop; an enabled Rust that declined is an error. */
function resolveRustOutcome(
  rust: TrainingResult | undefined,
  runTypeScriptLoop: () => TrainingResult,
): TrainingResult {
  if (rust !== undefined) return rust;
  if (isRustTrainDirEnabled()) {
    throw new Error(
      "trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; " +
        "refusing WASM/TypeScript fallback.",
    );
  }
  return runTypeScriptLoop();
}
