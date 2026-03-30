/**
 * WASM Memory Lifecycle Tests
 *
 * Issue #1505 - Memory leak detection tests for WASM activation lifecycle.
 *
 * Verifies that WASM resources are properly reclaimed after:
 * 1. Creating and disposing CompiledNetwork instances
 * 2. Running many creature.activate() calls in sequence
 * 3. disposeWasm() actually releases the cached activation
 * 4. Repeated activate/dispose cycles do not leave stale state
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import { activateEphemeral } from "@creature/CreatureActivation.ts";

/**
 * Create a deterministic creature for memory lifecycle testing.
 */
function createTestCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
    outputLayer: { squash: "IDENTITY" },
  });
  return creature;
}

// ---------------------------------------------------------------------------
// disposeWasm() clears cached activation
// ---------------------------------------------------------------------------

Deno.test("WasmMemoryLifecycle: disposeWasm clears cachedWasmActivation", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    creature.activate(input);
    assert(
      creature.cachedWasmActivation !== undefined,
      "Should have cached WASM activation after activate",
    );

    creature.disposeWasm();
    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "cachedWasmActivation should be undefined after disposeWasm",
    );
  } finally {
    creature.dispose();
  }
});

Deno.test("WasmMemoryLifecycle: disposeWasm is safe to call multiple times", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    creature.activate(input);

    // Call disposeWasm multiple times — should not throw
    creature.disposeWasm();
    creature.disposeWasm();
    creature.disposeWasm();

    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "Should remain undefined after multiple disposeWasm calls",
    );
  } finally {
    creature.dispose();
  }
});

Deno.test("WasmMemoryLifecycle: disposeWasm clears eligibility cache", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    creature.activate(input);
    // After activation, eligibility cache should be set
    assert(
      creature.wasmEligibilityCache !== undefined,
      "Should have eligibility cache after activate",
    );

    creature.disposeWasm();
    assertEquals(
      creature.wasmEligibilityCache,
      undefined,
      "Eligibility cache should be cleared after disposeWasm",
    );
  } finally {
    creature.dispose();
  }
});

// ---------------------------------------------------------------------------
// Repeated activate/dispose cycles
// ---------------------------------------------------------------------------

Deno.test("WasmMemoryLifecycle: repeated activate-dispose cycles produce consistent output", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    // First activation to get reference output
    const referenceOutput = Array.from(creature.activate(input));
    creature.disposeWasm();

    // Repeat activate/dispose 50 times and verify outputs remain consistent
    for (let i = 0; i < 50; i++) {
      const output = creature.activate(input);
      creature.disposeWasm();

      assertEquals(
        output.length,
        referenceOutput.length,
        `Cycle ${i}: output length should match reference`,
      );
      for (let j = 0; j < referenceOutput.length; j++) {
        assertEquals(
          output[j],
          referenceOutput[j],
          `Cycle ${i}: output[${j}] should match reference`,
        );
      }
    }
  } finally {
    creature.dispose();
  }
});

Deno.test("WasmMemoryLifecycle: many creatures activated and disposed leave no cached state", () => {
  const creatures: Creature[] = [];
  const input = new Float32Array([0.5, 0.8]);
  const N = 100;

  try {
    for (let i = 0; i < N; i++) {
      const creature = createTestCreature();
      creatures.push(creature);

      creature.activate(input);
      creature.disposeWasm();

      assertEquals(
        creature.cachedWasmActivation,
        undefined,
        `Creature ${i} should have no cached WASM after disposeWasm`,
      );
    }
  } finally {
    for (const creature of creatures) {
      creature.dispose();
    }
  }
});

// ---------------------------------------------------------------------------
// Ephemeral activation does not leak cached state
// ---------------------------------------------------------------------------

Deno.test("WasmMemoryLifecycle: ephemeral activation leaves no cached WASM on creature", () => {
  const creatures: Creature[] = [];
  const input = new Float32Array([0.5, 0.8]);
  const N = 50;

  try {
    for (let i = 0; i < N; i++) {
      const creature = createTestCreature();
      creatures.push(creature);

      activateEphemeral(creature, input, false);

      assertEquals(
        creature.cachedWasmActivation,
        undefined,
        `Creature ${i} should have no cached WASM after ephemeral activation`,
      );
    }
  } finally {
    for (const creature of creatures) {
      creature.dispose();
    }
  }
});

// ---------------------------------------------------------------------------
// dispose() (full creature dispose) also frees WASM
// ---------------------------------------------------------------------------

Deno.test("WasmMemoryLifecycle: creature.dispose() frees WASM activation", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  creature.activate(input);
  assert(
    creature.cachedWasmActivation !== undefined,
    "Should have cached WASM before dispose",
  );

  creature.dispose();
  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "cachedWasmActivation should be undefined after full dispose",
  );
});

// ---------------------------------------------------------------------------
// Sequential activation of many unique creatures respects LRU bounds
// ---------------------------------------------------------------------------

Deno.test("WasmMemoryLifecycle: sequential activation respects LRU capacity", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  const MAX_CACHED = 10;
  setMaxCachedWasmCreatureActivations(MAX_CACHED);

  const creatures: Creature[] = [];
  const input = new Float32Array([0.5, 0.8]);
  const N = 50;

  try {
    for (let i = 0; i < N; i++) {
      const creature = createTestCreature();
      creatures.push(creature);
      creature.activate(input);
    }

    // The LRU cache should not exceed the configured maximum
    const cacheCount = getCachedWasmActivationCount();
    assert(
      cacheCount <= MAX_CACHED,
      `LRU cache count (${cacheCount}) should not exceed max (${MAX_CACHED})`,
    );
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
    for (const creature of creatures) {
      creature.dispose();
    }
  }
});

Deno.test("WasmMemoryLifecycle: evicted creatures have WASM disposed", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  const MAX_CACHED = 5;
  setMaxCachedWasmCreatureActivations(MAX_CACHED);

  const creatures: Creature[] = [];
  const input = new Float32Array([0.5, 0.8]);
  const N = 20;

  try {
    for (let i = 0; i < N; i++) {
      const creature = createTestCreature();
      creatures.push(creature);
      creature.activate(input);
    }

    // With N=20 and max=5, early creatures should have been evicted
    // and their cached WASM activation should be undefined
    let evictedCount = 0;
    for (const creature of creatures) {
      if (creature.cachedWasmActivation === undefined) {
        evictedCount++;
      }
    }

    assert(
      evictedCount >= N - MAX_CACHED,
      `At least ${
        N - MAX_CACHED
      } creatures should have been evicted (no cached WASM), got ${evictedCount}`,
    );
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
    for (const creature of creatures) {
      creature.dispose();
    }
  }
});
