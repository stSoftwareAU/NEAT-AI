/**
 * TrainingSamples.ts — Per-file sample index selection and data
 * augmentation used inside the training loop.
 *
 * Issue #2399: Extracted from TrainingLoop.ts so the loop stays focused
 * on iteration/flow control while the pointwise-data concerns live here.
 */

import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { RandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { applyNoise } from "@propagate/DataFuzzing.ts";
import { quantiseBuffer } from "@propagate/DataQuantisation.ts";
import type { RequiredDataFuzzingConfig } from "@config/DataFuzzingConfig.ts";
import type { RequiredDataQuantisationConfig } from "@config/DataQuantisationConfig.ts";

/**
 * Scratch allocator: reuses a single Int32Array across files, growing
 * only when a larger file is encountered.
 */
export interface ScratchIndexBuffer {
  buffer: Int32Array | null;
}

/**
 * Builds the sorted set of record indexes to sample from a training
 * file, honouring `disableRandomSamples`, `feedbackLoop`, and
 * `trainingSampleRate`. The returned set is sorted ascending so disk
 * reads proceed sequentially.
 *
 * Mutates `scratch.buffer` in place to avoid per-file allocations.
 */
export function selectFileSampleIndexes(
  fileRecords: number,
  trainingSampleRate: number,
  disableRandomSamples: boolean | undefined,
  feedbackLoop: boolean,
  scratch: ScratchIndexBuffer,
): Set<number> {
  // Issue #1540: Reuse scratch buffer across files.
  if (!scratch.buffer || scratch.buffer.length < fileRecords) {
    scratch.buffer = new Int32Array(fileRecords);
  }
  for (let i = 0; i < fileRecords; i++) {
    scratch.buffer[i] = i;
  }

  const indexView = scratch.buffer.subarray(0, fileRecords);

  if (!disableRandomSamples && !feedbackLoop) {
    CreatureUtil.shuffle(indexView);
  }

  const len = Math.ceil(fileRecords * trainingSampleRate);
  const actualLen = Math.min(len, fileRecords);
  const selectedIndexes = new Int32Array(actualLen);
  for (let i = 0; i < actualLen; i++) {
    selectedIndexes[i] = indexView[i];
  }
  selectedIndexes.sort((a, b) => a - b);

  return new Set(selectedIndexes);
}

/**
 * Apply data quantisation and fuzzing (in that order) to a pair of
 * observation and target buffers. Both buffers are mutated in place.
 *
 * Issue #1900 / #1901.
 */
export function applyDataAugmentation(
  observationsBuffer: Float32Array,
  targetsBuffer: Float32Array,
  fuzzingConfig: RequiredDataFuzzingConfig,
  quantisationConfig: RequiredDataQuantisationConfig,
  rng: RandomNumberGenerator,
): void {
  if (quantisationConfig.enabled) {
    quantiseBuffer(observationsBuffer, quantisationConfig.inputLevels);
    if (quantisationConfig.outputLevels > 0) {
      quantiseBuffer(targetsBuffer, quantisationConfig.outputLevels);
    }
  }

  if (fuzzingConfig.enabled) {
    applyNoise(
      observationsBuffer,
      fuzzingConfig.inputNoiseScale,
      fuzzingConfig.noiseType,
      rng,
    );
    if (fuzzingConfig.outputNoiseScale > 0) {
      applyNoise(
        targetsBuffer,
        fuzzingConfig.outputNoiseScale,
        fuzzingConfig.noiseType,
        rng,
      );
    }
  }
}
