/**
 * Benchmark: DeDuplicator splice optimisation (Issue #1477)
 *
 * This benchmark measures the performance improvement from replacing
 * the splice-based removal loop with an O(n) filter approach.
 *
 * The optimisation:
 * - Previously: Loop through toRemove in reverse, calling creatures.splice(indx, 1)
 *   for each duplicate. Each splice shifts all subsequent elements: O(n * d).
 * - Now: Build a Set of indices to remove, then filter in a single pass: O(n).
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/DeDuplicatorSpliceOptimisation.ts
 */

/**
 * Simulates the old splice-based removal approach.
 * For each index in toRemove (iterated in reverse), calls splice(indx, 1).
 */
function removeBySplice(arr: number[], toRemove: number[]): number[] {
  const copy = [...arr];
  for (let removeIndx = toRemove.length; removeIndx--;) {
    const indx = toRemove[removeIndx];
    copy.splice(indx, 1);
  }
  return copy;
}

/**
 * Simulates the new filter-based removal approach.
 * Builds a Set of indices to remove, then filters in a single pass.
 * Mutates the array in-place by overwriting and truncating.
 */
function removeByFilter(arr: number[], toRemove: number[]): number[] {
  const copy = [...arr];
  const removeSet = new Set(toRemove);
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < copy.length; readIndex++) {
    if (!removeSet.has(readIndex)) {
      copy[writeIndex++] = copy[readIndex];
    }
  }
  copy.length = writeIndex;
  return copy;
}

// --- Small population (100 elements, 10% duplicates) ---

const smallSize = 100;
const smallDuplicateRate = 0.1;
const smallToRemove: number[] = [];
for (let i = 0; i < Math.floor(smallSize * smallDuplicateRate); i++) {
  smallToRemove.push(Math.floor(Math.random() * smallSize));
}
// Deduplicate and sort indices
const smallRemoveSet = [...new Set(smallToRemove)].sort((a, b) => a - b);
const smallArr = Array.from({ length: smallSize }, (_, i) => i);

Deno.bench({
  name:
    `Splice removal (${smallSize} elements, ${smallRemoveSet.length} removals)`,
  group: "Small population",
  fn() {
    removeBySplice(smallArr, smallRemoveSet);
  },
});

Deno.bench({
  name:
    `Filter removal (${smallSize} elements, ${smallRemoveSet.length} removals)`,
  group: "Small population",
  baseline: true,
  fn() {
    removeByFilter(smallArr, smallRemoveSet);
  },
});

// --- Medium population (1000 elements, 30% duplicates) ---

const medSize = 1000;
const medDuplicateRate = 0.3;
const medToRemoveRaw: number[] = [];
for (let i = 0; i < Math.floor(medSize * medDuplicateRate); i++) {
  medToRemoveRaw.push(Math.floor(Math.random() * medSize));
}
const medRemoveSet = [...new Set(medToRemoveRaw)].sort((a, b) => a - b);
const medArr = Array.from({ length: medSize }, (_, i) => i);

Deno.bench({
  name: `Splice removal (${medSize} elements, ${medRemoveSet.length} removals)`,
  group: "Medium population",
  fn() {
    removeBySplice(medArr, medRemoveSet);
  },
});

Deno.bench({
  name: `Filter removal (${medSize} elements, ${medRemoveSet.length} removals)`,
  group: "Medium population",
  baseline: true,
  fn() {
    removeByFilter(medArr, medRemoveSet);
  },
});

// --- Large population (10000 elements, 50% duplicates) ---

const largeSize = 10000;
const largeDuplicateRate = 0.5;
const largeToRemoveRaw: number[] = [];
for (let i = 0; i < Math.floor(largeSize * largeDuplicateRate); i++) {
  largeToRemoveRaw.push(Math.floor(Math.random() * largeSize));
}
const largeRemoveSet = [...new Set(largeToRemoveRaw)].sort((a, b) => a - b);
const largeArr = Array.from({ length: largeSize }, (_, i) => i);

Deno.bench({
  name:
    `Splice removal (${largeSize} elements, ${largeRemoveSet.length} removals)`,
  group: "Large population",
  fn() {
    removeBySplice(largeArr, largeRemoveSet);
  },
});

Deno.bench({
  name:
    `Filter removal (${largeSize} elements, ${largeRemoveSet.length} removals)`,
  group: "Large population",
  baseline: true,
  fn() {
    removeByFilter(largeArr, largeRemoveSet);
  },
});

// --- Very large population (50000 elements, 50% duplicates) ---

const vLargeSize = 50000;
const vLargeDuplicateRate = 0.5;
const vLargeToRemoveRaw: number[] = [];
for (let i = 0; i < Math.floor(vLargeSize * vLargeDuplicateRate); i++) {
  vLargeToRemoveRaw.push(Math.floor(Math.random() * vLargeSize));
}
const vLargeRemoveSet = [...new Set(vLargeToRemoveRaw)].sort((a, b) => a - b);
const vLargeArr = Array.from({ length: vLargeSize }, (_, i) => i);

Deno.bench({
  name:
    `Splice removal (${vLargeSize} elements, ${vLargeRemoveSet.length} removals)`,
  group: "Very large population",
  fn() {
    removeBySplice(vLargeArr, vLargeRemoveSet);
  },
});

Deno.bench({
  name:
    `Filter removal (${vLargeSize} elements, ${vLargeRemoveSet.length} removals)`,
  group: "Very large population",
  baseline: true,
  fn() {
    removeByFilter(vLargeArr, vLargeRemoveSet);
  },
});
