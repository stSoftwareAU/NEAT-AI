/**
 * Issue #1540 - Benchmark: Per-iteration allocations in training loop
 *
 * Measures the overhead of:
 * 1. Creating frozen BackPropagationConfig each iteration vs mutating in place
 * 2. Allocating Int32Array scratch buffers vs reusing pre-allocated ones
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-write bench/TrainingLoopAllocations.ts
 */

import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { BackPropagationArguments } from "@propagate/BackPropagation.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

// ============================================================================
// 1. BackPropagationConfig: frozen copy vs mutable update
// ============================================================================

const baseConfig = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  learningRateStrategy: "fixed",
});

const ITERATIONS = 100;

Deno.bench({
  name: `Frozen config copy per iteration (${ITERATIONS} iters)`,
  group: "config-allocation",
  baseline: true,
}, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    const _iterationConfig = createBackPropagationConfig({
      ...baseConfig,
      generations: baseConfig.generations + i,
      learningRate: 0.01 * Math.pow(0.95, i),
    });
    // Prevent dead-code elimination
    if (_iterationConfig.generations < 0) throw new Error("unreachable");
  }
});

Deno.bench({
  name: `Mutable config update per iteration (${ITERATIONS} iters)`,
  group: "config-allocation",
}, () => {
  const mutableConfig = { ...baseConfig } as BackPropagationArguments;
  for (let i = 0; i < ITERATIONS; i++) {
    mutableConfig.generations = baseConfig.generations + i;
    mutableConfig.learningRate = 0.01 * Math.pow(0.95, i);
    // Prevent dead-code elimination
    if (mutableConfig.generations < 0) throw new Error("unreachable");
  }
});

// ============================================================================
// 2. Int32Array allocation: fresh per file vs reusing scratch buffer
// ============================================================================

const FILE_COUNT = 10;
const RECORDS_PER_FILE = 5000;
const SAMPLE_RATE = 0.5;

Deno.bench({
  name:
    `Fresh Int32Array per file (${FILE_COUNT} files, ${RECORDS_PER_FILE} records)`,
  group: "index-allocation",
  baseline: true,
}, () => {
  for (let f = 0; f < FILE_COUNT; f++) {
    const fileRecords = RECORDS_PER_FILE;
    const tmpIndexes = new Int32Array(fileRecords);
    for (let i = 0; i < fileRecords; i++) {
      tmpIndexes[i] = i;
    }
    CreatureUtil.shuffle(tmpIndexes);

    const len = Math.ceil(fileRecords * SAMPLE_RATE);
    const actualLen = Math.min(len, tmpIndexes.length);
    const selectedIndexes = new Int32Array(actualLen);
    for (let i = 0; i < actualLen; i++) {
      selectedIndexes[i] = tmpIndexes[i];
    }
    selectedIndexes.sort((a, b) => a - b);
    // Prevent dead-code elimination
    if (selectedIndexes[0] < -1) throw new Error("unreachable");
  }
});

Deno.bench({
  name:
    `Reused scratch Int32Array (${FILE_COUNT} files, ${RECORDS_PER_FILE} records)`,
  group: "index-allocation",
}, () => {
  let scratchBuffer: Int32Array | null = null;

  for (let f = 0; f < FILE_COUNT; f++) {
    const fileRecords = RECORDS_PER_FILE;

    // Reuse or grow scratch buffer
    if (!scratchBuffer || scratchBuffer.length < fileRecords) {
      scratchBuffer = new Int32Array(fileRecords);
    }

    for (let i = 0; i < fileRecords; i++) {
      scratchBuffer[i] = i;
    }
    CreatureUtil.shuffle(scratchBuffer);

    const len = Math.ceil(fileRecords * SAMPLE_RATE);
    const actualLen = Math.min(len, fileRecords);
    // Use subarray view instead of allocating a new Int32Array
    const selectedView = scratchBuffer.subarray(0, actualLen);
    // Sort just the selected portion
    const selectedIndexes = new Int32Array(selectedView);
    selectedIndexes.sort((a, b) => a - b);
    // Prevent dead-code elimination
    if (selectedIndexes[0] < -1) throw new Error("unreachable");
  }
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1540: Per-iteration allocations in training loop");
console.log("=".repeat(70));
console.log(
  "Measures overhead of frozen config copy and Int32Array allocation.",
);
console.log("Lower is better.\n");
