/**
 * Benchmark: indexOf/includes to Map/Set lookup optimisation (Issue #1763)
 *
 * Measures the performance improvement from replacing O(n) indexOf()/includes()
 * calls inside loops (creating O(n²) overall) with O(1) Map/Set lookups.
 *
 * Three patterns are benchmarked:
 * 1. weightedRandomSelect: indexOf() inside reduce + for-of → index-based loop
 * 2. appliedTypes: includes() inside loop → Set.has()
 * 3. Index mapping: indexOf() inside .map() → Map.get()
 *
 * Run with:
 *   deno bench bench/IndexOfToMapLookup.ts
 */

// --- Pattern 1: weightedRandomSelect ---

/** Old approach: uses indexOf() inside reduce and for-of loop. */
function weightedSelectOld<T>(items: T[]): T {
  const totalWeight = items.reduce(
    (sum, item) => sum + 1 / (items.indexOf(item) + 1),
    0,
  );
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= 1 / (items.indexOf(item) + 1);
    if (random <= 0) return item;
  }
  return items[0];
}

/** New approach: uses index-based iteration, no indexOf(). */
function weightedSelectNew<T>(items: T[]): T {
  let totalWeight = 0;
  for (let i = 0; i < items.length; i++) {
    totalWeight += 1 / (i + 1);
  }
  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= 1 / (i + 1);
    if (random <= 0) return items[i];
  }
  return items[0];
}

// --- Pattern 2: appliedTypes tracking ---

/** Old approach: uses includes() to check for duplicate types. */
function trackTypesOld(types: string[]): string[] {
  const appliedTypes: string[] = [];
  for (const t of types) {
    if (!appliedTypes.includes(t)) {
      appliedTypes.push(t);
    }
  }
  return appliedTypes;
}

/** New approach: uses Set for O(1) has() checks. */
function trackTypesNew(types: string[]): string[] {
  const appliedTypes = new Set<string>();
  for (const t of types) {
    appliedTypes.add(t);
  }
  return [...appliedTypes];
}

// --- Benchmark data ---

const sizes = [50, 200, 1000];

for (const size of sizes) {
  const items = Array.from({ length: size }, (_, i) => ({ id: i }));

  // Pattern 1: weightedRandomSelect
  Deno.bench({
    name: `indexOf weightedSelect (${size} items)`,
    group: `weightedSelect ${size}`,
    fn() {
      weightedSelectOld(items);
    },
  });

  Deno.bench({
    name: `index-loop weightedSelect (${size} items)`,
    group: `weightedSelect ${size}`,
    baseline: true,
    fn() {
      weightedSelectNew(items);
    },
  });
}

// Pattern 2: appliedTypes tracking
const typeOptions = [
  "remove-low-impact",
  "remove-neuron",
  "remove-synapse",
  "add-neurons",
  "add-synapses",
  "change-squash",
  "cache-informed-removal",
];

for (const size of [20, 100, 500]) {
  const types = Array.from(
    { length: size },
    () => typeOptions[Math.floor(Math.random() * typeOptions.length)],
  );

  Deno.bench({
    name: `includes() type tracking (${size} items)`,
    group: `typeTracking ${size}`,
    fn() {
      trackTypesOld(types);
    },
  });

  Deno.bench({
    name: `Set type tracking (${size} items)`,
    group: `typeTracking ${size}`,
    baseline: true,
    fn() {
      trackTypesNew(types);
    },
  });
}

// Pattern 3: Index mapping — real-world scenario
// In CombinedFromSuccessful, the Map is built once and used for two .map() calls
// (removal indices + non-removal indices). Compare the combined cost.

/** Old approach: two indexOf-based .map() calls (no pre-computation). */
function indexMapOldCombined<T>(
  allItems: T[],
  subsetA: T[],
  subsetB: T[],
): [number[], number[]] {
  return [
    subsetA.map((item) => allItems.indexOf(item)),
    subsetB.map((item) => allItems.indexOf(item)),
  ];
}

/** New approach: build Map once, use for both lookups. */
function indexMapNewCombined<T>(
  allItems: T[],
  subsetA: T[],
  subsetB: T[],
): [number[], number[]] {
  const indexMap = new Map<T, number>();
  for (let i = 0; i < allItems.length; i++) {
    indexMap.set(allItems[i], i);
  }
  return [
    subsetA.map((item) => indexMap.get(item)!),
    subsetB.map((item) => indexMap.get(item)!),
  ];
}

for (const size of sizes) {
  const allItems = Array.from({ length: size }, (_, i) => ({ id: i }));
  // Two subsets: ~20% and ~30% of items (simulates removal + non-removal)
  const subsetA = allItems.filter((_, i) => i % 5 === 0);
  const subsetB = allItems.filter((_, i) => i % 5 !== 0);

  Deno.bench({
    name: `2x indexOf mapping (${size} items)`,
    group: `indexMapping ${size}`,
    fn() {
      indexMapOldCombined(allItems, subsetA, subsetB);
    },
  });

  Deno.bench({
    name: `Map-once mapping (${size} items)`,
    group: `indexMapping ${size}`,
    baseline: true,
    fn() {
      indexMapNewCombined(allItems, subsetA, subsetB);
    },
  });
}
