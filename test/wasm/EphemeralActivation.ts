/**
 * EphemeralActivation Unit Tests
 *
 * Issue #1504 - Reduce WASM CompiledNetwork memory retention after creature.activate()
 *
 * Verifies:
 * 1. activateEphemeral() produces the same outputs as activate()
 * 2. activateEphemeral() does not cache the CompiledNetwork on the creature
 * 3. getCachedWasmActivationCount() returns the correct count
 * 4. activateEphemeral() works when creature already has a cached activation
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "../../src/wasm/WasmCreatureActivationLRU.ts";
import { activateEphemeral } from "../../src/creature/CreatureActivation.ts";

/**
 * Create a deterministic creature for testing.
 */
function createTestCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
    outputLayer: { squash: "IDENTITY" },
  });
  return creature;
}

// ---------------------------------------------------------------------------
// activateEphemeral tests
// ---------------------------------------------------------------------------

Deno.test("activateEphemeral: produces same output as activate", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    const normalResult = creature.activate(input);
    // Dispose cached WASM to start fresh
    creature.disposeWasm();

    const ephemeralResult = activateEphemeral(creature, input, false);

    assertEquals(
      ephemeralResult.length,
      normalResult.length,
      "Output lengths should match",
    );
    for (let i = 0; i < normalResult.length; i++) {
      assertEquals(
        ephemeralResult[i],
        normalResult[i],
        `Output at index ${i} should match`,
      );
    }
  } finally {
    creature.dispose();
  }
});

Deno.test("activateEphemeral: does not cache CompiledNetwork on creature", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    // Ensure no cached activation
    creature.disposeWasm();
    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "Should start without cached WASM",
    );

    activateEphemeral(creature, input, false);

    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "Should not cache WASM activation after ephemeral activate",
    );
  } finally {
    creature.dispose();
  }
});

Deno.test("activateEphemeral: works when creature already has a cached activation", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    // First, establish a cached activation via normal activate
    const normalResult = creature.activate(input);

    // Now ephemeral should also work and produce the same result
    const ephemeralResult = activateEphemeral(creature, input, false);

    assertEquals(
      ephemeralResult.length,
      normalResult.length,
      "Output lengths should match",
    );
    for (let i = 0; i < normalResult.length; i++) {
      assertEquals(
        ephemeralResult[i],
        normalResult[i],
        `Output at index ${i} should match`,
      );
    }

    // The cached activation should still be present (not disposed)
    assert(
      creature.cachedWasmActivation !== undefined,
      "Existing cached activation should be preserved",
    );
  } finally {
    creature.dispose();
  }
});

Deno.test("activateEphemeral: does not affect LRU cache count", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.8]);

  try {
    // Ensure no prior cached activation
    creature.disposeWasm();

    const countBefore = getCachedWasmActivationCount();
    activateEphemeral(creature, input, false);
    const countAfter = getCachedWasmActivationCount();

    assertEquals(
      countAfter,
      countBefore,
      "LRU cache count should not change after ephemeral activation",
    );
  } finally {
    creature.dispose();
  }
});

// ---------------------------------------------------------------------------
// getCachedWasmActivationCount tests
// ---------------------------------------------------------------------------

Deno.test("getCachedWasmActivationCount: returns current entry count", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  setMaxCachedWasmCreatureActivations(512);
  try {
    const creature = createTestCreature();
    const input = new Float32Array([0.5, 0.8]);

    // Activate so we know at least one entry is in the cache
    creature.activate(input);

    const count = getCachedWasmActivationCount();
    assert(
      count >= 1,
      `Count should be at least 1 after activating a creature, got ${count}`,
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
  }
});

Deno.test("getCachedWasmActivationCount: increases after activate", () => {
  const originalMax = getMaxCachedWasmCreatureActivations();
  setMaxCachedWasmCreatureActivations(512);
  try {
    const creature = createTestCreature();
    const input = new Float32Array([0.5, 0.8]);

    // Ensure this creature has no cached activation before we start
    creature.disposeWasm();

    const countBefore = getCachedWasmActivationCount();
    creature.activate(input);
    const countAfter = getCachedWasmActivationCount();

    assertEquals(
      countAfter,
      countBefore + 1,
      `Count should increase by exactly 1 after first activate (was ${countBefore}, now ${countAfter})`,
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(originalMax);
  }
});
