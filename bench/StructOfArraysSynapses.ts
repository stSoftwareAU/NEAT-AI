/**
 * Issue #1662 - Benchmark: Struct-of-arrays synapse storage
 *
 * Compares the current object-based Synapse[] (array-of-structs) with
 * parallel typed arrays (struct-of-arrays) across key hot paths:
 *
 * 1. Inward connection lookup (filter by `.to`)
 * 2. Sequential weight read (backprop scan)
 * 3. Binary search by (from, to)
 * 4. Sequential iteration + read all fields (breeding/export)
 * 5. Weight mutation (write `.weight` / `synapseWeight[i]`)
 *
 * Run with:
 *   deno bench --allow-read bench/StructOfArraysSynapses.ts
 */

import { Synapse } from "../src/architecture/Synapse.ts";
import { CompactSynapseStore } from "../src/architecture/CompactSynapseStore.ts";

// ============================================================================
// Test data generation
// ============================================================================

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1662);

/**
 * Build parallel Synapse[] and CompactSynapseStore with identical data.
 * Synapses are sorted by (from, to).
 */
function buildTestData(neuronCount: number, synapseCount: number) {
  const fromArr: number[] = [];
  const toArr: number[] = [];
  const weightArr: number[] = [];

  // Generate unique (from, to) pairs
  const pairs = new Set<string>();
  while (fromArr.length < synapseCount) {
    const from = Math.floor(Math.abs(random()) * (neuronCount - 1));
    const to = Math.floor(Math.abs(random()) * (neuronCount - 1)) + 1;
    if (from === to) continue;
    const key = `${from},${to}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    fromArr.push(from);
    toArr.push(to);
    weightArr.push(random() * 0.5);
  }

  // Sort by (from, to) to match creature.synapses order
  const indices = Array.from({ length: synapseCount }, (_, i) => i);
  indices.sort((a, b) => {
    if (fromArr[a] !== fromArr[b]) return fromArr[a] - fromArr[b];
    return toArr[a] - toArr[b];
  });

  const sortedFrom = indices.map((i) => fromArr[i]);
  const sortedTo = indices.map((i) => toArr[i]);
  const sortedWeight = indices.map((i) => weightArr[i]);

  // Build Synapse[] (array-of-structs)
  const synapses: Synapse[] = [];
  for (let i = 0; i < synapseCount; i++) {
    synapses.push(new Synapse(sortedFrom[i], sortedTo[i], sortedWeight[i]));
  }

  // Build CompactSynapseStore (struct-of-arrays)
  const store = CompactSynapseStore.fromArrays(
    sortedFrom,
    sortedTo,
    sortedWeight,
  );

  // Pre-compute some lookup targets
  const toTargets: number[] = [];
  for (let i = 0; i < Math.min(20, neuronCount); i++) {
    toTargets.push(
      Math.floor(Math.abs(random()) * neuronCount),
    );
  }

  // Pre-compute some (from, to) pairs that exist
  const existingPairs: [number, number][] = [];
  for (let i = 0; i < Math.min(20, synapseCount); i++) {
    const idx = Math.floor(Math.abs(random()) * synapseCount);
    existingPairs.push([sortedFrom[idx], sortedTo[idx]]);
  }

  return { synapses, store, toTargets, existingPairs, neuronCount };
}

// Small, medium, and large datasets
const small = buildTestData(50, 200);
const medium = buildTestData(200, 2000);
const large = buildTestData(500, 10000);

console.log(
  `Small: ${small.synapses.length} synapses, ${small.neuronCount} neurons`,
);
console.log(
  `Medium: ${medium.synapses.length} synapses, ${medium.neuronCount} neurons`,
);
console.log(
  `Large: ${large.synapses.length} synapses, ${large.neuronCount} neurons`,
);

// ============================================================================
// 1. Inward connection lookup (filter by .to) — linear scan
// ============================================================================

function objectInwardLookup(synapses: Synapse[], toIndx: number): number {
  let count = 0;
  for (let i = 0; i < synapses.length; i++) {
    if (synapses[i].to === toIndx) count++;
  }
  return count;
}

function soaInwardLookup(store: CompactSynapseStore, toIndx: number): number {
  let count = 0;
  const synapseTo = store.synapseTo;
  const len = store.count;
  for (let i = 0; i < len; i++) {
    if (synapseTo[i] === toIndx) count++;
  }
  return count;
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Inward lookup (${label}) - Synapse[]`,
    group: `inward-${label}`,
    baseline: true,
  }, () => {
    for (const t of data.toTargets) {
      objectInwardLookup(data.synapses, t);
    }
  });

  Deno.bench({
    name: `Inward lookup (${label}) - CompactSynapseStore`,
    group: `inward-${label}`,
  }, () => {
    for (const t of data.toTargets) {
      soaInwardLookup(data.store, t);
    }
  });
}

// ============================================================================
// 2. Sequential weight read (backprop scan)
// ============================================================================

function objectWeightSum(synapses: Synapse[]): number {
  let sum = 0;
  for (let i = 0; i < synapses.length; i++) {
    sum += synapses[i].weight;
  }
  return sum;
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Weight sum (${label}) - Synapse[]`,
    group: `weight-sum-${label}`,
    baseline: true,
  }, () => {
    objectWeightSum(data.synapses);
  });

  Deno.bench({
    name: `Weight sum (${label}) - CompactSynapseStore`,
    group: `weight-sum-${label}`,
  }, () => {
    data.store.sumWeights();
  });
}

// ============================================================================
// 3. Binary search by (from, to)
// ============================================================================

function objectBinarySearch(
  synapses: Synapse[],
  from: number,
  to: number,
): number {
  let low = 0;
  let high = synapses.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from) {
      low = mid + 1;
    } else if (syn.from > from) {
      high = mid - 1;
    } else {
      if (syn.to < to) {
        low = mid + 1;
      } else if (syn.to > to) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
  }
  return -1;
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Binary search (${label}) - Synapse[]`,
    group: `binary-search-${label}`,
    baseline: true,
  }, () => {
    for (const [from, to] of data.existingPairs) {
      objectBinarySearch(data.synapses, from, to);
    }
  });

  Deno.bench({
    name: `Binary search (${label}) - CompactSynapseStore`,
    group: `binary-search-${label}`,
  }, () => {
    for (const [from, to] of data.existingPairs) {
      data.store.binarySearchFromTo(from, to);
    }
  });
}

// ============================================================================
// 4. Sequential iteration — read all fields (breeding/export pattern)
// ============================================================================

function objectFullIteration(synapses: Synapse[]): number {
  let checksum = 0;
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    checksum += s.from + s.to + s.weight;
  }
  return checksum;
}

function soaFullIteration(store: CompactSynapseStore): number {
  let checksum = 0;
  const from = store.synapseFrom;
  const to = store.synapseTo;
  const weight = store.synapseWeight;
  for (let i = 0; i < store.count; i++) {
    checksum += from[i] + to[i] + weight[i];
  }
  return checksum;
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Full iteration (${label}) - Synapse[]`,
    group: `full-iter-${label}`,
    baseline: true,
  }, () => {
    objectFullIteration(data.synapses);
  });

  Deno.bench({
    name: `Full iteration (${label}) - CompactSynapseStore`,
    group: `full-iter-${label}`,
  }, () => {
    soaFullIteration(data.store);
  });
}

// ============================================================================
// 5. Weight mutation (write pattern during backprop)
// ============================================================================

function objectWeightMutate(synapses: Synapse[]): void {
  for (let i = 0; i < synapses.length; i++) {
    synapses[i].weight *= 0.999;
  }
}

function soaWeightMutate(store: CompactSynapseStore): void {
  const w = store.synapseWeight;
  for (let i = 0; i < store.count; i++) {
    w[i] *= 0.999;
  }
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Weight mutate (${label}) - Synapse[]`,
    group: `weight-mutate-${label}`,
    baseline: true,
  }, () => {
    objectWeightMutate(data.synapses);
  });

  Deno.bench({
    name: `Weight mutate (${label}) - CompactSynapseStore`,
    group: `weight-mutate-${label}`,
  }, () => {
    soaWeightMutate(data.store);
  });
}

// ============================================================================
// 6. Build secondary index (sort by .to) — object copy+sort vs typed array sort
// ============================================================================

function objectBuildToIndex(synapses: Synapse[]): Synapse[] {
  return synapses.slice().sort((a, b) => {
    if (a.to !== b.to) return a.to - b.to;
    return a.from - b.from;
  });
}

function soaBuildToIndex(
  store: CompactSynapseStore,
): { to: Int32Array; from: Int32Array; weight: Float64Array } {
  // Build index array, sort by (to, from)
  const n = store.count;
  const indices = new Int32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;

  // Sort indices by (to, from) using the typed arrays
  const sortedIndices = Array.from(indices).sort((a, b) => {
    if (store.synapseTo[a] !== store.synapseTo[b]) {
      return store.synapseTo[a] - store.synapseTo[b];
    }
    return store.synapseFrom[a] - store.synapseFrom[b];
  });

  // Scatter into new parallel arrays
  const to = new Int32Array(n);
  const from = new Int32Array(n);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const src = sortedIndices[i];
    to[i] = store.synapseTo[src];
    from[i] = store.synapseFrom[src];
    weight[i] = store.synapseWeight[src];
  }
  return { to, from, weight };
}

for (
  const [label, data] of [["small", small], ["medium", medium], [
    "large",
    large,
  ]] as const
) {
  Deno.bench({
    name: `Build to-index (${label}) - Synapse[]`,
    group: `to-index-${label}`,
    baseline: true,
  }, () => {
    objectBuildToIndex(data.synapses);
  });

  Deno.bench({
    name: `Build to-index (${label}) - CompactSynapseStore`,
    group: `to-index-${label}`,
  }, () => {
    soaBuildToIndex(data.store);
  });
}

console.log("\n" + "=".repeat(70));
console.log(
  "Issue #1662: Struct-of-arrays synapse storage benchmark",
);
console.log("=".repeat(70));
console.log(
  "Comparing Synapse[] (array-of-structs) vs CompactSynapseStore (struct-of-arrays).",
);
console.log("Lower is better.\n");
