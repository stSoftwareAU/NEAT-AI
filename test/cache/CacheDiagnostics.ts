/**
 * Cache Diagnostics Tests
 *
 * Issue #1616: Verifies that CacheStats are tracked correctly across
 * instrumented caches, and that getCacheStats() aggregates results.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { getCacheStats } from "@cache/getCacheStats.ts";
import {
  clearDistanceCache,
  getCachedDistance,
  getDistanceCacheStats,
  setCachedDistance,
  setDistanceCacheMaxSize,
} from "@breed/DistanceCache.ts";
import {
  disposeAllCachedWasmActivations,
  getMaxCachedWasmCreatureActivations,
  getWasmActivationLruStats,
  noteWasmCreatureActivationUse,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";

// ---------------------------------------------------------------------------
// CacheStats interface shape
// ---------------------------------------------------------------------------

Deno.test("CacheStats: getCacheStats returns array with expected caches", () => {
  const stats = getCacheStats();
  assert(Array.isArray(stats), "Should return an array");
  assert(stats.length >= 3, "Should have at least 3 cache entries");

  const names = stats.map((s) => s.name);
  assert(
    names.includes("WASM Compilation Cache"),
    "Should include WASM Compilation Cache",
  );
  assert(
    names.includes("WASM Activation LRU"),
    "Should include WASM Activation LRU",
  );
  assert(names.includes("Distance Cache"), "Should include Distance Cache");
});

Deno.test("CacheStats: each entry has required fields", () => {
  const stats = getCacheStats();
  for (const entry of stats) {
    assertEquals(typeof entry.name, "string", "name should be a string");
    assertEquals(typeof entry.hits, "number", "hits should be a number");
    assertEquals(typeof entry.misses, "number", "misses should be a number");
    assertEquals(
      typeof entry.evictions,
      "number",
      "evictions should be a number",
    );
    assertEquals(
      typeof entry.currentSize,
      "number",
      "currentSize should be a number",
    );
    assertEquals(typeof entry.maxSize, "number", "maxSize should be a number");
  }
});

// ---------------------------------------------------------------------------
// WASM Activation LRU stats
// ---------------------------------------------------------------------------

Deno.test("WasmActivationLruStats: tracks hits and misses", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();
    resetWasmActivationLruStats();

    const creature = new Creature(1, 1);
    creature.fix();

    // First use is a miss (new entry)
    noteWasmCreatureActivationUse(creature);
    // Second use is a hit (existing entry moved to head)
    noteWasmCreatureActivationUse(creature);
    // Third use is a hit
    noteWasmCreatureActivationUse(creature);

    const stats = getWasmActivationLruStats();
    assertEquals(stats.hits, 2, "Should have 2 hits");
    assertEquals(stats.misses, 1, "Should have 1 miss");
    assertEquals(stats.currentSize, 1, "Should have 1 entry");
    assertEquals(stats.name, "WASM Activation LRU");

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
  }
});

Deno.test("WasmActivationLruStats: tracks evictions", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(2);
    disposeAllCachedWasmActivations();
    resetWasmActivationLruStats();

    const creatures: Creature[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new Creature(1, 1);
      c.fix();
      creatures.push(c);
    }

    noteWasmCreatureActivationUse(creatures[0]); // miss
    noteWasmCreatureActivationUse(creatures[1]); // miss
    noteWasmCreatureActivationUse(creatures[2]); // miss, evicts creatures[0]

    const stats = getWasmActivationLruStats();
    assertEquals(stats.misses, 3, "Should have 3 misses");
    assertEquals(stats.evictions, 1, "Should have 1 eviction");
    assertEquals(stats.currentSize, 2, "Should have 2 entries");
    assertEquals(stats.maxSize, 2, "maxSize should be 2");

    for (const c of creatures) c.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
  }
});

Deno.test("WasmActivationLruStats: resetStats clears counters", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();
    resetWasmActivationLruStats();

    const creature = new Creature(1, 1);
    creature.fix();
    noteWasmCreatureActivationUse(creature);
    noteWasmCreatureActivationUse(creature);

    resetWasmActivationLruStats();
    const stats = getWasmActivationLruStats();
    assertEquals(stats.hits, 0, "Hits should be 0 after reset");
    assertEquals(stats.misses, 0, "Misses should be 0 after reset");
    assertEquals(stats.evictions, 0, "Evictions should be 0 after reset");
    // currentSize is not reset — it reflects actual cache state
    assertEquals(
      stats.currentSize,
      1,
      "currentSize should still reflect actual state",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
  }
});

// ---------------------------------------------------------------------------
// Distance Cache stats
// ---------------------------------------------------------------------------

Deno.test("DistanceCacheStats: returns CacheStats with evictions", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(3);

  setCachedDistance("a", "b", 0.1);
  setCachedDistance("c", "d", 0.2);
  setCachedDistance("e", "f", 0.3);

  // Access "a-b" to make it more recent
  getCachedDistance("a", "b");

  // Add a fourth entry, which should evict one
  setCachedDistance("g", "h", 0.4);

  const stats = getDistanceCacheStats();
  assertEquals(stats.name, "Distance Cache");
  assertEquals(stats.currentSize, 3, "Should have 3 entries");
  assertEquals(stats.maxSize, 3, "maxSize should be 3");
  assert(stats.evictions >= 1, "Should have at least 1 eviction");
  assert(stats.hits >= 1, "Should have at least 1 hit from getCachedDistance");
  assert(stats.misses >= 0, "Misses should be non-negative");

  // Reset
  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCacheStats: clearDistanceCache resets counters", () => {
  clearDistanceCache();
  setCachedDistance("x", "y", 0.5);
  getCachedDistance("x", "y");
  getCachedDistance("no", "match");

  clearDistanceCache();
  const stats = getDistanceCacheStats();
  assertEquals(stats.hits, 0, "Hits should be 0 after clear");
  assertEquals(stats.misses, 0, "Misses should be 0 after clear");
  assertEquals(stats.evictions, 0, "Evictions should be 0 after clear");
  assertEquals(stats.currentSize, 0, "Size should be 0 after clear");
});

// ---------------------------------------------------------------------------
// getCacheStats aggregation
// ---------------------------------------------------------------------------

Deno.test("getCacheStats: includes distance cache stats after operations", () => {
  clearDistanceCache();
  setCachedDistance("agg-a", "agg-b", 0.5);
  getCachedDistance("agg-a", "agg-b"); // hit

  const stats = getCacheStats();
  const distanceStats = stats.find((s) => s.name === "Distance Cache");
  assert(distanceStats !== undefined, "Should include Distance Cache");
  assert(
    distanceStats!.hits >= 1,
    "Distance cache should report at least 1 hit",
  );

  clearDistanceCache();
});

Deno.test("getCacheStats: counters are non-negative", () => {
  const stats = getCacheStats();
  for (const entry of stats) {
    assert(entry.hits >= 0, `${entry.name}: hits should be non-negative`);
    assert(entry.misses >= 0, `${entry.name}: misses should be non-negative`);
    assert(
      entry.evictions >= 0,
      `${entry.name}: evictions should be non-negative`,
    );
    assert(
      entry.currentSize >= 0,
      `${entry.name}: currentSize should be non-negative`,
    );
    assert(entry.maxSize >= 1, `${entry.name}: maxSize should be at least 1`);
  }
});
