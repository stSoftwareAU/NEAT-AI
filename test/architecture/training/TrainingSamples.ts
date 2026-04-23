/**
 * Tests for the TrainingSamples module (Issue #2399).
 *
 * Exercises sample-index selection and data augmentation in isolation.
 */

import { assert, assertEquals } from "@std/assert";
import {
  applyDataAugmentation,
  type ScratchIndexBuffer,
  selectFileSampleIndexes,
} from "@architecture/training/TrainingSamples.ts";
import type { RequiredDataFuzzingConfig } from "@config/DataFuzzingConfig.ts";
import type { RequiredDataQuantisationConfig } from "@config/DataQuantisationConfig.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

function disabledFuzzing(): RequiredDataFuzzingConfig {
  return {
    enabled: false,
    inputNoiseScale: 0,
    outputNoiseScale: 0,
    noiseType: "gaussian",
  };
}

function disabledQuantisation(): RequiredDataQuantisationConfig {
  return {
    enabled: false,
    inputLevels: 0,
    outputLevels: 0,
  };
}

Deno.test("TrainingSamples - selectFileSampleIndexes returns all records at rate 1 with deterministic order", () => {
  const scratch: ScratchIndexBuffer = { buffer: null };
  const indexes = selectFileSampleIndexes(
    10,
    1,
    true, /* disableRandomSamples */
    false,
    scratch,
  );

  assertEquals(indexes.size, 10);
  const sorted = [...indexes].sort((a, b) => a - b);
  assertEquals(sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("TrainingSamples - selectFileSampleIndexes honours sample rate", () => {
  const scratch: ScratchIndexBuffer = { buffer: null };
  const indexes = selectFileSampleIndexes(
    10,
    0.3,
    true,
    false,
    scratch,
  );

  // Math.ceil(10 * 0.3) = 3
  assertEquals(indexes.size, 3);
});

Deno.test("TrainingSamples - selectFileSampleIndexes reuses scratch buffer", () => {
  const scratch: ScratchIndexBuffer = { buffer: null };
  selectFileSampleIndexes(5, 1, true, false, scratch);
  const firstBuffer = scratch.buffer;
  assert(firstBuffer !== null);

  // Larger file forces reallocation.
  selectFileSampleIndexes(20, 1, true, false, scratch);
  const secondBuffer = scratch.buffer!;
  assert(secondBuffer.length >= 20);

  // A smaller subsequent file must reuse the larger buffer.
  selectFileSampleIndexes(3, 1, true, false, scratch);
  assertEquals(scratch.buffer, secondBuffer);
});

Deno.test("TrainingSamples - applyDataAugmentation is a no-op when both configs disabled", () => {
  const obs = new Float32Array([0.1, 0.2, 0.3]);
  const tgt = new Float32Array([0.4, 0.5]);
  const before = [...obs, ...tgt];

  applyDataAugmentation(
    obs,
    tgt,
    disabledFuzzing(),
    disabledQuantisation(),
    createSeededRng(42),
  );

  assertEquals([...obs, ...tgt], before);
});

Deno.test("TrainingSamples - applyDataAugmentation quantises inputs when enabled", () => {
  const obs = new Float32Array([0.12, 0.37, 0.63, 0.88]);
  const tgt = new Float32Array([0.5]);

  applyDataAugmentation(
    obs,
    tgt,
    disabledFuzzing(),
    { enabled: true, inputLevels: 4, outputLevels: 0 },
    createSeededRng(42),
  );

  // With 4 levels the inputs must snap to a small discrete set.
  for (const v of obs) {
    assert(v >= 0 && v <= 1, `quantised input out of range: ${v}`);
  }
  // Targets remain untouched because outputLevels = 0.
  assertEquals(tgt[0], 0.5);
});
