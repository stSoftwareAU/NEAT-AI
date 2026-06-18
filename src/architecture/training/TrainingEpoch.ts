/**
 * TrainingEpoch.ts — Single-epoch execution over all binary files.
 *
 * Issue #2399: Extracted from TrainingLoop.ts. One epoch is one pass
 * over every binary file using the current sample index sets. Per-epoch
 * outcome decisions (improvement vs regression) live in
 * `TrainingOutcome.ts`; data-augmentation and sample-index selection
 * live in `TrainingSamples.ts`.
 */

import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { WasmError } from "@errors/WasmError.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { applyDropout } from "@propagate/Dropout.ts";
import type { TrainingSetupState } from "@architecture/training/TrainingSetup.ts";
import type { EpochState } from "@architecture/training/TrainingOutcome.ts";
import {
  applyDataAugmentation,
  selectFileSampleIndexes,
} from "@architecture/training/TrainingSamples.ts";

/** Run a single epoch over all binary files. */
export function runSingleEpoch(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
  state: EpochState,
): { errorSum: number; counter: number; trainingStopped: boolean } {
  const rng = getRandomNumberGenerator();
  const startTS = Date.now();
  let lastTS = startTS;

  let counter = 0;
  let totalRecords = 0;
  let errorSum = 0;
  let trainingStopped = false;

  for (let fileIndx = binaryFiles.length; !trainingStopped && fileIndx--;) {
    const fn = binaryFiles[fileIndx];
    const file = Deno.openSync(fn, { read: true });

    try {
      let recordSet = state.indxMap.get(fn);
      const stat = file.statSync();
      const fileRecords = stat.size / setup.BYTES_PER_RECORD;

      if (!recordSet) {
        totalRecords += fileRecords;
        if (fileIndx === 0) state.knownSampleCount = totalRecords;

        recordSet = selectFileSampleIndexes(
          fileRecords,
          setup.trainingSampleRate,
          options.disableRandomSamples,
          setup.feedbackLoop,
          state.scratch,
        );
        state.indxMap.set(fn, recordSet);
      }

      for (const recordIndex of recordSet) {
        file.seekSync(
          recordIndex * setup.BYTES_PER_RECORD,
          Deno.SeekMode.Start,
        );

        const bytesRead = file.readSync(setup.recordBuffer);
        if (bytesRead === null || bytesRead !== setup.BYTES_PER_RECORD) {
          getLogger().warn(
            `Failed to read complete record at index ${recordIndex}`,
          );
          continue;
        }

        // Issue #1297: Copy into pre-allocated buffers.
        setup.observationsBuffer.set(
          setup.recordArray.subarray(0, creature.input),
        );
        setup.targetsBuffer.set(setup.recordArray.subarray(creature.input));

        applyDataAugmentation(
          setup.observationsBuffer,
          setup.targetsBuffer,
          setup.fuzzingConfig,
          setup.quantisationConfig,
          rng,
        );

        // Issue #2483: A `WasmError` from `activateAndTrace` means WASM
        // could not compile/instantiate this creature (e.g. `RuntimeError:
        // unreachable` on a corrupted topology). Drop the creature
        // gracefully — stop training without crashing the worker.
        let output: Float32Array;
        try {
          output = creature.activateAndTrace(
            setup.observationsBuffer,
            setup.feedbackLoop,
            state.sparseConfig,
          );
        } catch (error) {
          if (error instanceof WasmError) {
            getLogger().warn(
              `Training ${blue(setup.ID)} dropping creature ${
                creature.uuid ?? "(no-uuid)"
              } (neurons=${creature.neurons.length}): WASM activation failed: ${error.message}`,
            );
            trainingStopped = true;
            break;
          }
          throw error;
        }

        // Issue #1860: Apply inverted dropout to hidden neuron activations.
        if (setup.iterationConfig.dropoutRate > 0) {
          applyDropout(creature, setup.iterationConfig.dropoutRate, rng);
        }

        const sampleError = cost.calculate(setup.targetsBuffer, output);
        assert(Number.isFinite(sampleError), "Sample error is not finite");
        errorSum += sampleError;
        counter++;

        if (!Number.isFinite(errorSum)) {
          getLogger().warn(
            `Training ${
              blue(setup.ID)
            } stopped as errorSum is not finite: ${errorSum} sampleError: ${sampleError} counter: ${counter} record.output: ${setup.targetsBuffer} output: ${output}`,
          );
          trainingStopped = true;
          break;
        }
        if (
          state.bestError !== undefined && counter < state.knownSampleCount
        ) {
          const bestPossibleError = errorSum / state.knownSampleCount;
          if (bestPossibleError > state.bestError) {
            getLogger().warn(
              `Training ${blue(setup.ID)} stopped as 'best possible' error ${
                yellow(bestPossibleError.toFixed(3))
              } > 'best' error ${
                yellow(state.bestError.toFixed(3))
              } at counter ${yellow(counter.toFixed(0))} of ${
                yellow(state.knownSampleCount.toFixed(0))
              }`,
            );
            trainingStopped = true;
            break;
          }
        }

        creature.propagate(
          setup.targetsBuffer,
          setup.iterationConfig,
          state.sparseConfig,
        );

        const now = Date.now();

        // Issue #3053: evaluate the per-task wall-clock timeout on every
        // sample, not only behind the 60s progress-log gate. Previously the
        // check was nested inside the 60s gate, so a task could overrun its
        // cap by up to a full sample batch + 60s. This is the worker-side
        // watchdog that abandons a stuck task promptly once its `timeoutTS`
        // is exceeded.
        if (state.timeoutTS && now > state.timeoutTS) {
          state.timedOut = true;
          const totalTime = now - startTS;
          getLogger().info(
            `Training ${blue(setup.ID)} timed out after ${
              yellow(format(totalTime, { ignoreZero: true }))
            }`,
          );
          trainingStopped = true;
          break;
        }

        if (now - lastTS > 60_000) {
          lastTS = now;
          const totalTime = now - startTS;
          logProgress(setup, state, counter, errorSum, totalTime);
        }
      }
      if (trainingStopped) break;
    } finally {
      file.close();
    }
  }

  return { errorSum, counter, trainingStopped };
}

/** Emit a progress line to the logger. */
function logProgress(
  setup: TrainingSetupState,
  state: EpochState,
  counter: number,
  errorSum: number,
  totalTime: number,
): void {
  getLogger().info(
    `Training ${blue(setup.ID)} samples`,
    yellow(counter.toLocaleString("en-AU")),
    `${
      state.knownSampleCount > 0
        ? "of " + yellow(state.knownSampleCount.toLocaleString("en-AU")) +
          " " +
          yellow((counter / state.knownSampleCount * 100).toFixed(1) + "%")
        : ""
    }${
      setup.trainingSampleRate < 1
        ? "( rate " +
          yellow((setup.trainingSampleRate * 100).toFixed(1) + "% )")
        : ""
    }`,
    "error",
    yellow((errorSum / counter).toFixed(3)),
    "time average:",
    yellow(format(totalTime / counter, { ignoreZero: true })),
    "total:",
    yellow(format(totalTime, { ignoreZero: true })),
  );
}
