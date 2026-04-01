/**
 * Benchmark for Fitness.ts topology grouping optimisation (Issue #2123).
 *
 * Compares:
 * 1. Grouping disabled: [...array] copy vs direct use (no copy)
 * 2. Grouping enabled: inline hash computation vs pre-computed hash Map
 *
 * Run with:
 *   deno bench bench/FitnessTopologyGrouping.ts
 */

/**
 * Simulates sorting with inline hash computation (old approach).
 * The hash function is called O(n log n) times inside the comparator.
 */
function sortWithInlineHash(items: string[]): string[] {
  const queue = [...items]; // unnecessary copy
  queue.sort((a, b) => {
    // Simulate hash computation (string manipulation)
    const hashA = a.split("").reverse().join("");
    const hashB = b.split("").reverse().join("");
    return hashA.localeCompare(hashB);
  });
  return queue;
}

/**
 * Simulates sorting with pre-computed hash Map (new approach).
 * Hashes are computed O(n) times upfront, then lookups are O(1).
 */
function sortWithPrecomputedHash(items: string[]): string[] {
  // No copy — sort in-place
  const hashCache = new Map<string, string>();
  for (const item of items) {
    if (!hashCache.has(item)) {
      hashCache.set(item, item.split("").reverse().join(""));
    }
  }
  items.sort((a, b) => {
    return hashCache.get(a)!.localeCompare(hashCache.get(b)!);
  });
  return items;
}

/**
 * Simulates the grouping-disabled path: [...array] spread copy (old)
 * vs direct use (new).
 */
function withArrayCopy(items: string[]): string[] {
  return [...items];
}

function withoutArrayCopy(items: string[]): string[] {
  return items;
}

// Generate test data
function generateItems(size: number): string[] {
  const items: string[] = [];
  for (let i = 0; i < size; i++) {
    items.push(`item-${i}-${Math.random().toString(36).substring(2, 10)}`);
  }
  return items;
}

// ============================================
// Grouping DISABLED: array copy elimination
// ============================================

const items100 = generateItems(100);
const items500 = generateItems(500);
const items1000 = generateItems(1000);

Deno.bench({
  name: "[...array] copy (old) — 100 items",
  group: "grouping-disabled-100",
  baseline: true,
  fn() {
    withArrayCopy(items100);
  },
});

Deno.bench({
  name: "direct use (new) — 100 items",
  group: "grouping-disabled-100",
  fn() {
    withoutArrayCopy(items100);
  },
});

Deno.bench({
  name: "[...array] copy (old) — 500 items",
  group: "grouping-disabled-500",
  baseline: true,
  fn() {
    withArrayCopy(items500);
  },
});

Deno.bench({
  name: "direct use (new) — 500 items",
  group: "grouping-disabled-500",
  fn() {
    withoutArrayCopy(items500);
  },
});

Deno.bench({
  name: "[...array] copy (old) — 1000 items",
  group: "grouping-disabled-1000",
  baseline: true,
  fn() {
    withArrayCopy(items1000);
  },
});

Deno.bench({
  name: "direct use (new) — 1000 items",
  group: "grouping-disabled-1000",
  fn() {
    withoutArrayCopy(items1000);
  },
});

// ============================================
// Grouping ENABLED: hash pre-computation
// ============================================

Deno.bench({
  name: "inline hash (old) — 100 items",
  group: "grouping-enabled-100",
  baseline: true,
  fn() {
    sortWithInlineHash([...items100]);
  },
});

Deno.bench({
  name: "pre-computed hash (new) — 100 items",
  group: "grouping-enabled-100",
  fn() {
    sortWithPrecomputedHash([...items100]);
  },
});

Deno.bench({
  name: "inline hash (old) — 500 items",
  group: "grouping-enabled-500",
  baseline: true,
  fn() {
    sortWithInlineHash([...items500]);
  },
});

Deno.bench({
  name: "pre-computed hash (new) — 500 items",
  group: "grouping-enabled-500",
  fn() {
    sortWithPrecomputedHash([...items500]);
  },
});

Deno.bench({
  name: "inline hash (old) — 1000 items",
  group: "grouping-enabled-1000",
  baseline: true,
  fn() {
    sortWithInlineHash([...items1000]);
  },
});

Deno.bench({
  name: "pre-computed hash (new) — 1000 items",
  group: "grouping-enabled-1000",
  fn() {
    sortWithPrecomputedHash([...items1000]);
  },
});
