/**
 * Tests for the TrainingSamples module (Issue #2399).
 *
 * Exercises sample-index selection in isolation.
 */

import { assert, assertEquals } from "@std/assert";
import {
  type ScratchIndexBuffer,
  selectFileSampleIndexes,
} from "@architecture/training/TrainingSamples.ts";

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
