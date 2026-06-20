/**
 * Benchmark for discovery selected-indices persistence cost.
 *
 * Issue #3086: During discovery recording, `record()` previously re-serialised
 * and rewrote the entire (monotonically growing) selected-indices map to disk on
 * every batch via a blocking `writeTextFileSync`. Persistence is already provided
 * by the per-chunk flush write (`writeRustParquetChunk`) and the end-of-phase
 * flush, so the per-batch write was redundant O(batches × total_indices) blocking
 * I/O on the dominant recording phase.
 *
 * This benchmark contrasts the two persistence strategies on a representative
 * recording workload:
 *   1. per-batch  — serialise + write the whole growing map every batch (before)
 *   2. per-flush  — serialise + write only on each chunk flush + once at the end
 *                   (after)
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/DiscoveryIndicesPersistence.ts
 */

import { appendAll } from "@utils/ArrayAppend.ts";

// Representative recording shape: 256 batches of 128 indices each across a
// single binary file, with a chunk flush every 16 batches (matching the order
// of magnitude of discoveryRustFlushRecords / discoveryBatchSize defaults).
const BATCH_COUNT = 256;
const BATCH_SIZE = 128;
const FLUSH_EVERY = 16;

const tempDir = Deno.makeTempDirSync({ prefix: "bench-indices-" });
const indicesFilePath = `${tempDir}/selected_indices.json`;
const binaryFilePath = `${tempDir}/training_data.bin`;

function makeBatch(start: number): number[] {
  const out = new Array<number>(BATCH_SIZE);
  for (let i = 0; i < BATCH_SIZE; i++) out[i] = start + i;
  return out;
}

const batches: number[][] = [];
for (let b = 0; b < BATCH_COUNT; b++) batches.push(makeBatch(b * BATCH_SIZE));

/** Old behaviour: write the whole growing map after every batch. */
function perBatchPersistence(): void {
  const selectedIndices: Record<string, number[]> = {};
  selectedIndices[binaryFilePath] = [];
  for (let b = 0; b < BATCH_COUNT; b++) {
    appendAll(selectedIndices[binaryFilePath], batches[b]);
    Deno.writeTextFileSync(indicesFilePath, JSON.stringify(selectedIndices));
  }
}

/** New behaviour: write only on each chunk flush plus a single final write. */
function perFlushPersistence(): void {
  const selectedIndices: Record<string, number[]> = {};
  selectedIndices[binaryFilePath] = [];
  for (let b = 0; b < BATCH_COUNT; b++) {
    appendAll(selectedIndices[binaryFilePath], batches[b]);
    if ((b + 1) % FLUSH_EVERY === 0) {
      Deno.writeTextFileSync(indicesFilePath, JSON.stringify(selectedIndices));
    }
  }
  // Single end-of-phase flush.
  Deno.writeTextFileSync(indicesFilePath, JSON.stringify(selectedIndices));
}

Deno.bench({
  name: "selected-indices persistence — per-batch write (before, Issue #3086)",
  group: "discovery-indices-persistence",
  baseline: true,
  fn: perBatchPersistence,
});

Deno.bench({
  name: "selected-indices persistence — per-flush write (after, Issue #3086)",
  group: "discovery-indices-persistence",
  fn: perFlushPersistence,
});
