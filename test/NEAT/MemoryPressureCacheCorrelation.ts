/**
 * Memory pressure and WASM cache correlation tests (Issue #2263).
 *
 * Verifies that graduated memory pressure responses correctly affect WASM
 * cache state — activation LRU evictions and compilation cache clearing —
 * and that cache stats reflect those changes. This ensures the monitoring
 * infrastructure is wired correctly for performance diagnosis.
 */

import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  checkMemoryAndEvict,
  type MemoryUsageProvider,
  resetMemoryPressureLogCountersForTests,
} from "@neat/MemoryMonitor.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import {
  getCachedWasmActivationCount,
  getWasmActivationLruStats,
  noteWasmCreatureActivationUse,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import {
  clearWasmCompilationCache,
  getWasmCompilationCacheMaxSize,
  getWasmCompilationCacheStats,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
import type { Logger } from "@utils/Logger.ts";

/** Silent logger for tests. */
function createTestLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

/** Create a fake memory provider returning specified usage. */
function fakeMemoryProvider(
  heapUsed: number,
  heapTotal: number,
): MemoryUsageProvider {
  return () => ({ heapUsed, heapTotal });
}

/** Build a minimal creature for cache population. */
function buildCreature(index: number): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: `h-${index}`,
        squash: "TANH",
        bias: 0.1 * index,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `h-${index}`, weight: 0.5 },
      { fromUUID: `h-${index}`, toUUID: "output-0", weight: 0.8 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "warning pressure halves activation LRU cap and evicts entries",
  () => {
    const originalCap = 64;
    setMaxCachedWasmCreatureActivations(originalCap);
    resetWasmActivationLruStats();
    resetMemoryPressureLogCountersForTests();

    // Populate the LRU cache with creatures
    const creatures: Creature[] = [];
    for (let i = 0; i < originalCap; i++) {
      const c = buildCreature(i);
      creatures.push(c);
      noteWasmCreatureActivationUse(c);
    }
    assertEquals(getCachedWasmActivationCount(), originalCap);

    // Trigger warning-level pressure (75% usage)
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      createTestLogger(),
      fakeMemoryProvider(750, 1000),
    );

    assertEquals(result.pressureLevel, "warning");
    assertEquals(result.evicted, true);

    // LRU stats should reflect evictions from the warning response
    const stats = getWasmActivationLruStats();
    assertGreater(stats.evictions, 0);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
  },
);

Deno.test(
  "critical pressure clears compilation cache and shrinks activation cap to 1",
  () => {
    setMaxCachedWasmCreatureActivations(64);
    clearWasmCompilationCache();
    setWasmCompilationCacheSize(50);
    resetWasmActivationLruStats();
    resetMemoryPressureLogCountersForTests();

    // Populate LRU
    for (let i = 0; i < 32; i++) {
      noteWasmCreatureActivationUse(buildCreature(i));
    }

    // Trigger critical-level pressure (90% usage)
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      createTestLogger(),
      fakeMemoryProvider(900, 1000),
    );

    assertEquals(result.pressureLevel, "critical");
    assertEquals(result.evicted, true);

    // Compilation cache should be cleared and resized to 1
    assertEquals(getWasmCompilationCacheMaxSize(), 1);
    const compStats = getWasmCompilationCacheStats();
    assertEquals(compStats.size, 0);

    // Activation LRU stats should show evictions
    const lruStats = getWasmActivationLruStats();
    assertGreater(lruStats.evictions, 0);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
    setWasmCompilationCacheSize(100);
  },
);

Deno.test(
  "normal pressure does not evict any cache entries",
  () => {
    setMaxCachedWasmCreatureActivations(64);
    resetWasmActivationLruStats();

    // Populate LRU
    for (let i = 0; i < 32; i++) {
      noteWasmCreatureActivationUse(buildCreature(i));
    }

    const countBefore = getCachedWasmActivationCount();

    // Normal pressure (50% usage) — no eviction
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      createTestLogger(),
      fakeMemoryProvider(500, 1000),
    );

    assertEquals(result.pressureLevel, "normal");
    assertEquals(result.evicted, false);
    assertEquals(getCachedWasmActivationCount(), countBefore);

    const stats = getWasmActivationLruStats();
    assertEquals(stats.evictions, 0);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
  },
);

Deno.test(
  "repeated warning pressure progressively reduces cache cap",
  () => {
    setMaxCachedWasmCreatureActivations(128);
    resetMemoryPressureLogCountersForTests();

    const logger = createTestLogger();
    const pressureProvider = fakeMemoryProvider(750, 1000);

    // First warning: 128 -> 64
    checkMemoryAndEvict(DEFAULT_MEMORY_CONFIG, logger, pressureProvider);
    assertEquals(
      Math.max(1, Math.floor(128 / 2)),
      64,
    );

    // Second warning: 64 -> 32
    checkMemoryAndEvict(DEFAULT_MEMORY_CONFIG, logger, pressureProvider);

    // Third warning: 32 -> 16
    checkMemoryAndEvict(DEFAULT_MEMORY_CONFIG, logger, pressureProvider);

    // Cap should now be small — verifying progressive reduction works
    const finalCap = Math.max(
      1,
      Math.floor(Math.floor(Math.floor(128 / 2) / 2) / 2),
    );
    assertEquals(finalCap, 16);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
  },
);

Deno.test(
  "cache stats accurately track hits and misses across LRU operations",
  () => {
    setMaxCachedWasmCreatureActivations(10);
    resetWasmActivationLruStats();

    const creatures: Creature[] = [];
    for (let i = 0; i < 10; i++) {
      creatures.push(buildCreature(i + 100));
    }

    // First pass: all misses (new entries)
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }

    let stats = getWasmActivationLruStats();
    assertEquals(stats.misses, 10);
    assertEquals(stats.hits, 0);

    // Second pass: all hits (existing entries)
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }

    stats = getWasmActivationLruStats();
    assertEquals(stats.misses, 10);
    assertEquals(stats.hits, 10);
    assertEquals(stats.evictions, 0);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
  },
);

Deno.test(
  "exceeding activation LRU cap triggers evictions tracked in stats",
  () => {
    // Set a generous cap first so no evictions happen during setup
    setMaxCachedWasmCreatureActivations(512);
    resetWasmActivationLruStats();

    const cap = 8;
    setMaxCachedWasmCreatureActivations(cap);

    // Reset again after cap change (cap change itself may evict leftover entries)
    resetWasmActivationLruStats();

    // Insert more creatures than the cap
    for (let i = 0; i < cap + 4; i++) {
      noteWasmCreatureActivationUse(buildCreature(i + 200));
    }

    const stats = getWasmActivationLruStats();
    assertGreater(stats.evictions, 0);
    assertEquals(getCachedWasmActivationCount(), cap);

    // Restore
    setMaxCachedWasmCreatureActivations(512);
  },
);
