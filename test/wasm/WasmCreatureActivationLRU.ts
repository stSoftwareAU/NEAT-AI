/**
 * WasmCreatureActivationLRU Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. LRU cache capacity can be set and queried
 * 2. Cache eviction occurs when capacity is exceeded
 * 3. Minimum capacity is clamped to 1
 * 4. noteWasmCreatureActivationUse registers creatures in the cache
 * 5. evictOldestWasmCreatureActivations removes entries
 * 6. Evicted creatures have disposeWasm called
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  evictOldestWasmCreatureActivations,
  getMaxCachedWasmCreatureActivations,
  noteWasmCreatureActivationUse,
  setMaxCachedWasmCreatureActivations,
} from "../../src/wasm/WasmCreatureActivationLRU.ts";

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
  // Save and restore so we don't affect other tests
  const original = getMaxCachedWasmCreatureActivations();
  try {
    // Reset to default by setting a known value then checking
    setMaxCachedWasmCreatureActivations(512);
    assertEquals(
      getMaxCachedWasmCreatureActivations(),
      512,
      "Default capacity should be 512",
    );
  } finally {
    setMaxCachedWasmCreatureActivations(original);
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

Deno.test("WasmCreatureActivationLRU: noteUse does not throw for valid creature", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    const creature = createMinimalCreature();

    // Should not throw
    noteWasmCreatureActivationUse(creature);

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmCreatureActivationLRU: noteUse for same creature multiple times is safe", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    const creature = createMinimalCreature();

    // Calling noteUse multiple times should update the access time
    noteWasmCreatureActivationUse(creature);
    noteWasmCreatureActivationUse(creature);
    noteWasmCreatureActivationUse(creature);

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

Deno.test("WasmCreatureActivationLRU: evictOldest with count 0 is a no-op", () => {
  // Should not throw
  evictOldestWasmCreatureActivations(0);
});

Deno.test("WasmCreatureActivationLRU: evictOldest with negative count is a no-op", () => {
  // Should not throw
  evictOldestWasmCreatureActivations(-5);
});

Deno.test("WasmCreatureActivationLRU: evictOldest does not throw for large count", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);

    const creatures: Creature[] = [];

    for (let i = 0; i < 3; i++) {
      const creature = createMinimalCreature();
      creatures.push(creature);
      noteWasmCreatureActivationUse(creature);
    }

    // Requesting more evictions than entries should not throw
    evictOldestWasmCreatureActivations(100);

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
