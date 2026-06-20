/**
 * Issue #3087 - Benchmark: IF.propagate per-call typed-array allocation
 *
 * IF.propagate previously allocated two typed arrays on every call:
 *   - `indices` via the slow `Int32Array.from({ length }, cb)` form
 *   - `errorShares` via `new Float64Array(listLength)`
 *
 * Both were discarded at function exit. This benchmark isolates that
 * allocation pattern and compares it against acquiring pooled buffers from
 * `BackpropBuffers` and filling `indices` with a plain `for` loop.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/IfPropagateAllocation.ts
 */

import { BackpropBuffers } from "@propagate/BackpropBuffers.ts";

// Seeded random for reproducibility (mirrors the in-place shuffle iteration).
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = seededRandom(42);

// Simulate the per-neuron backprop step across a realistic IF-heavy network:
// many IF neurons, each propagated every sample, every epoch.
const IF_NEURON_COUNT = 600;
const MAX_INWARD = 16;

// Variable in-degree per IF neuron.
const inwardCounts = new Array<number>(IF_NEURON_COUNT);
for (let i = 0; i < IF_NEURON_COUNT; i++) {
  inwardCounts[i] = Math.max(1, Math.floor(random() * MAX_INWARD));
}

// In-place Fisher-Yates over the first `length` entries (matches
// CreatureUtil.shuffle semantics so both paths do equal shuffle work).
function shuffleSlice(array: Int32Array, length: number): void {
  if (length > 1) {
    for (let i = length; i--;) {
      const j = Math.round(random() * i);
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
  }
}

// Consume the buffers so the optimiser cannot eliminate the work.
let sink = 0;
function consume(indices: Int32Array, errorShares: Float64Array, len: number) {
  for (let i = 0; i < len; i++) {
    sink += indices[i] + errorShares[i];
  }
}

// ============================================================================
// Baseline: fresh typed arrays per call (the pre-#3087 code path)
// ============================================================================
Deno.bench({
  name: `Fresh typed-array allocation per IF.propagate (${IF_NEURON_COUNT}N)`,
  group: "if-propagate-allocation",
  baseline: true,
}, () => {
  for (let n = 0; n < IF_NEURON_COUNT; n++) {
    const listLength = inwardCounts[n];

    const indices = Int32Array.from({ length: listLength }, (_, i) => i);
    shuffleSlice(indices, indices.length);

    const errorShares = new Float64Array(listLength);
    for (let i = 0; i < listLength; i++) {
      errorShares[i] = i * 0.5;
    }

    consume(indices, errorShares, listLength);
  }
});

// ============================================================================
// Optimised: reuse pooled buffers, fill indices with a plain for loop
// ============================================================================
const buffers = new BackpropBuffers(MAX_INWARD);

Deno.bench({
  name: `Pooled buffers per IF.propagate (${IF_NEURON_COUNT}N)`,
  group: "if-propagate-allocation",
}, () => {
  for (let n = 0; n < IF_NEURON_COUNT; n++) {
    const listLength = inwardCounts[n];

    const buf = buffers.acquire(listLength);
    const indices = buf.indices;
    const errorShares = buf.errorShares;

    for (let i = 0; i < listLength; i++) {
      indices[i] = i;
    }
    shuffleSlice(indices, listLength);

    for (let i = 0; i < listLength; i++) {
      errorShares[i] = i * 0.5;
    }

    consume(indices, errorShares, listLength);
    buffers.release(buf);
  }
});

console.log("\n" + "=".repeat(70));
console.log("Issue #3087: IF.propagate per-call typed-array allocation");
console.log("=".repeat(70));
console.log(
  `Simulated ${IF_NEURON_COUNT} IF neurons, max ${MAX_INWARD} inward connections.`,
);
console.log(
  "Baseline allocates `indices` + `errorShares` fresh per call; optimised reuses pooled buffers.",
);
console.log(`Lower is better. (sink=${sink})`);
