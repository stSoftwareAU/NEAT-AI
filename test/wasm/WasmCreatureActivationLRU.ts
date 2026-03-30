/**
 * WasmCreatureActivationLRU Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 * Issue #1581 - Tests for bulk disposal and deregistration APIs
 *
 * Verifies:
 * 1. LRU cache capacity can be set and queried
 * 2. Cache eviction occurs when capacity is exceeded
 * 3. Minimum capacity is clamped to 1
 * 4. noteWasmCreatureActivationUse registers creatures in the cache
 * 5. evictOldestWasmCreatureActivations removes entries
 * 6. Evicted creatures have disposeWasm called
 * 7. disposeAllCachedWasmActivations flushes entire cache
 * 8. deregisterWasmCreatureActivation removes individual entries
 * 9. disposeWasm deregisters creature from LRU cache
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  deregisterWasmCreatureActivation,
  disposeAllCachedWasmActivations,
  evictOldestWasmCreatureActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  noteWasmCreatureActivationUse,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";

/**
 * Create a minimal creature for LRU testing.
 */
function createMinimalCreature(): Creature {
  const creature = new Creature(1, 1);
  creature.fix();
  return creature;
}

// ---------------------------------------------------------------------------
// Capacity configuration tests
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: default capacity is 512", () => {
  // Read the capacity before any test has altered it — relies on this test
  // running against a freshly-loaded module.  We save and restore so that
  // subsequent tests see a consistent value regardless of execution order.
  //
  // Note: when the test suite runs with --preload test/_preload.ts the cap
  // is lowered to 16 to avoid OOM under parallel execution.  Accept either
  // the source-code default (512) or the preload override (16).
  const defaultCapacity = getMaxCachedWasmCreatureActivations();
  try {
    assert(
      defaultCapacity === 512 || defaultCapacity === 16,
      `Default capacity should be 512 (source default) or 16 (test preload), got ${defaultCapacity}`,
    );
  } finally {
    setMaxCachedWasmCreatureActivations(defaultCapacity);
  }
});

Deno.test("WasmCreatureActivationLRU: setMax updates capacity", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(100);
    assertEquals(getMaxCachedWasmCreatureActivations(), 100);

    setMaxCachedWasmCreatureActivations(1);
    assertEquals(getMaxCachedWasmCreatureActivations(), 1);
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: capacity is clamped to minimum of 1", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(0);
    assertEquals(
      getMaxCachedWasmCreatureActivations(),
      1,
      "Values below 1 should be clamped to 1",
    );

    setMaxCachedWasmCreatureActivations(-5);
    assertEquals(
      getMaxCachedWasmCreatureActivations(),
      1,
      "Negative values should be clamped to 1",
    );
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: capacity is floored to integer", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(3.7);
    assertEquals(
      getMaxCachedWasmCreatureActivations(),
      3,
      "Non-integer should be floored",
    );
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Note usage tests
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: noteUse registers creature in cache", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();
    const before = getCachedWasmActivationCount();

    noteWasmCreatureActivationUse(creature);

    assert(
      getCachedWasmActivationCount() > before,
      "Cache count should increase after noteUse",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: noteUse for same creature multiple times does not duplicate", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();

    noteWasmCreatureActivationUse(creature);
    const countAfterFirst = getCachedWasmActivationCount();

    noteWasmCreatureActivationUse(creature);
    noteWasmCreatureActivationUse(creature);

    assertEquals(
      getCachedWasmActivationCount(),
      countAfterFirst,
      "Repeated noteUse for same creature should not increase cache count",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Eviction tests
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: eviction triggers disposeWasm on oldest creature", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    // Set tiny capacity
    setMaxCachedWasmCreatureActivations(2);

    const creatures: Creature[] = [];
    const disposedWasm: boolean[] = [];

    // Create 3 creatures and track disposeWasm calls
    for (let i = 0; i < 3; i++) {
      const creature = createMinimalCreature();
      const originalDispose = creature.disposeWasm.bind(creature);
      disposedWasm.push(false);
      const idx = i;
      creature.disposeWasm = () => {
        disposedWasm[idx] = true;
        originalDispose();
      };
      creatures.push(creature);
    }

    // Note usage for first two — within capacity
    noteWasmCreatureActivationUse(creatures[0]);
    noteWasmCreatureActivationUse(creatures[1]);

    // Third one should trigger eviction of the oldest (creatures[0])
    noteWasmCreatureActivationUse(creatures[2]);

    assert(
      disposedWasm[0],
      "Oldest creature should have disposeWasm called during eviction",
    );

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: evictOldest with count 0 preserves cache", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();
    noteWasmCreatureActivationUse(creature);
    const before = getCachedWasmActivationCount();

    evictOldestWasmCreatureActivations(0);

    assertEquals(
      getCachedWasmActivationCount(),
      before,
      "Cache count should be unchanged after evicting 0",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: evictOldest with negative count preserves cache", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();
    noteWasmCreatureActivationUse(creature);
    const before = getCachedWasmActivationCount();

    evictOldestWasmCreatureActivations(-5);

    assertEquals(
      getCachedWasmActivationCount(),
      before,
      "Cache count should be unchanged after evicting negative count",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: evictOldest with count exceeding cache size empties cache", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creatures: Creature[] = [];

    for (let i = 0; i < 3; i++) {
      const creature = createMinimalCreature();
      creatures.push(creature);
      noteWasmCreatureActivationUse(creature);
    }

    assertEquals(getCachedWasmActivationCount(), 3, "Should have 3 entries");

    // Requesting more evictions than entries should evict all
    evictOldestWasmCreatureActivations(100);

    assertEquals(
      getCachedWasmActivationCount(),
      0,
      "Cache should be empty after evicting more than exist",
    );

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Reducing capacity triggers immediate eviction
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: reducing capacity triggers immediate eviction", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);

    const creatures: Creature[] = [];
    let disposeCount = 0;

    for (let i = 0; i < 5; i++) {
      const creature = createMinimalCreature();
      const originalDispose = creature.disposeWasm.bind(creature);
      creature.disposeWasm = () => {
        disposeCount++;
        originalDispose();
      };
      creatures.push(creature);
      noteWasmCreatureActivationUse(creature);
    }

    // Reduce capacity below current entry count
    setMaxCachedWasmCreatureActivations(2);

    assert(
      disposeCount >= 3,
      `Should have evicted at least 3 entries, got ${disposeCount}`,
    );

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Issue #1581: disposeAllCachedWasmActivations tests
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: disposeAll returns 0 on empty cache", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    // Flush any existing entries first
    disposeAllCachedWasmActivations();

    const disposed = disposeAllCachedWasmActivations();
    assertEquals(disposed, 0, "Empty cache should return 0");
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: disposeAll flushes all entries and calls disposeWasm", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    // Flush pre-existing entries
    disposeAllCachedWasmActivations();

    const creatures: Creature[] = [];
    let disposeCount = 0;

    for (let i = 0; i < 5; i++) {
      const creature = createMinimalCreature();
      const originalDispose = creature.disposeWasm.bind(creature);
      creature.disposeWasm = () => {
        disposeCount++;
        originalDispose();
      };
      creatures.push(creature);
      noteWasmCreatureActivationUse(creature);
    }

    assertEquals(getCachedWasmActivationCount(), 5, "Should have 5 entries");

    const disposed = disposeAllCachedWasmActivations();
    assertEquals(disposed, 5, "Should dispose all 5 entries");
    assertEquals(disposeCount, 5, "Should call disposeWasm on all 5 creatures");
    assertEquals(getCachedWasmActivationCount(), 0, "Cache should be empty");

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: disposeAll is idempotent", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();
    noteWasmCreatureActivationUse(creature);

    const first = disposeAllCachedWasmActivations();
    assertEquals(first, 1, "First call should dispose 1 entry");

    const second = disposeAllCachedWasmActivations();
    assertEquals(second, 0, "Second call should dispose 0 entries");

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Issue #1581: deregisterWasmCreatureActivation tests
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivationLRU: deregister removes creature from cache count", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createMinimalCreature();
    noteWasmCreatureActivationUse(creature);
    assertEquals(getCachedWasmActivationCount(), 1, "Should have 1 entry");

    deregisterWasmCreatureActivation(creature);
    assertEquals(
      getCachedWasmActivationCount(),
      0,
      "Should have 0 entries after deregister",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: deregister for unknown creature is a no-op", () => {
  const creature = createMinimalCreature();
  // Should not throw even though creature was never registered
  deregisterWasmCreatureActivation(creature);
  creature.dispose();
});

Deno.test("WasmCreatureActivationLRU: dispose() deregisters from LRU via disposeWasm", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creatures: Creature[] = [];
    for (let i = 0; i < 3; i++) {
      const creature = createMinimalCreature();
      creatures.push(creature);
      noteWasmCreatureActivationUse(creature);
    }

    assertEquals(getCachedWasmActivationCount(), 3, "Should have 3 entries");

    // Disposing a creature should remove it from the LRU cache
    creatures[1].dispose();
    assertEquals(
      getCachedWasmActivationCount(),
      2,
      "Should have 2 entries after disposing one creature",
    );

    // Clean up remaining
    creatures[0].dispose();
    creatures[2].dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});
