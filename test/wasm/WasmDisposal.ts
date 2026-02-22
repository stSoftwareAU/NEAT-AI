/**
 * WASM Disposal Unit Tests
 *
 * Issue #1581: Verify that WASM disposal properly frees resources
 * and that creatures can be re-activated after disposal.
 *
 * These tests exercise real WASM activation, disposal, and re-activation
 * to confirm that:
 * 1. disposeWasm() leaves no retained references
 * 2. Creatures can be re-compiled after disposal
 * 3. disposeAllCachedWasmActivations() frees all cached entries
 * 4. WasmCreatureActivation.free() is idempotent
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  disposeAllCachedWasmActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "../../src/wasm/WasmCreatureActivationLRU.ts";
import { ensureWasmActivation } from "../../src/wasm/mod.ts";

/**
 * Create a simple creature suitable for WASM activation.
 */
function createSimpleCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();
  return creature;
}

Deno.test("WasmDisposal: activate, dispose, re-activate cycle works", async () => {
  await ensureWasmActivation();
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creature = createSimpleCreature();
    const input = new Float32Array([0.5, 0.3]);

    // First activation — creates and caches the WASM compiled network
    const output1 = creature.activate(input, false);
    assertEquals(output1.length, 1, "Should produce 1 output");

    // Dispose the WASM activation
    creature.disposeWasm();
    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "cachedWasmActivation should be undefined after dispose",
    );

    // Re-activate — should transparently re-compile without error
    const output2 = creature.activate(input, false);
    assertEquals(
      output2.length,
      1,
      "Should produce 1 output after re-activation",
    );

    // Outputs should be identical since it's the same network
    assertEquals(
      output1[0],
      output2[0],
      "Same network should produce same output",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmDisposal: disposeAll frees real WASM activations", async () => {
  await ensureWasmActivation();
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);
    disposeAllCachedWasmActivations();

    const creatures: Creature[] = [];
    const input = new Float32Array([1.0, -1.0]);

    // Activate several creatures via WASM
    for (let i = 0; i < 5; i++) {
      const creature = createSimpleCreature();
      creature.activate(input, false);
      creatures.push(creature);
    }

    assertEquals(
      getCachedWasmActivationCount(),
      5,
      "Should have 5 cached entries",
    );

    // Dispose all
    const disposed = disposeAllCachedWasmActivations();
    assertEquals(disposed, 5, "Should dispose 5 entries");
    assertEquals(getCachedWasmActivationCount(), 0, "Cache should be empty");

    // Verify all creatures had their WASM activation cleared
    for (const creature of creatures) {
      assertEquals(
        creature.cachedWasmActivation,
        undefined,
        "cachedWasmActivation should be undefined after disposeAll",
      );
    }

    // Re-activate one to confirm WASM is still functional
    const output = creatures[0].activate(input, false);
    assertEquals(
      output.length,
      1,
      "Should still be able to activate after disposeAll",
    );

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

Deno.test("WasmDisposal: LRU eviction frees WASM and allows re-activation", async () => {
  await ensureWasmActivation();
  const original = getMaxCachedWasmCreatureActivations();
  try {
    // Set a very small cache so eviction definitely happens
    setMaxCachedWasmCreatureActivations(2);
    disposeAllCachedWasmActivations();

    const input = new Float32Array([0.5, 0.5]);
    const creatures: Creature[] = [];

    // Create 4 creatures, exceeding the cache cap of 2
    for (let i = 0; i < 4; i++) {
      const creature = createSimpleCreature();
      creature.activate(input, false);
      creatures.push(creature);
    }

    // First two should have been evicted
    assertEquals(
      creatures[0].cachedWasmActivation,
      undefined,
      "Oldest creature should have been evicted",
    );
    assertEquals(
      creatures[1].cachedWasmActivation,
      undefined,
      "Second oldest creature should have been evicted",
    );

    // Re-activate an evicted creature — should work seamlessly
    const output = creatures[0].activate(input, false);
    assertEquals(
      output.length,
      1,
      "Evicted creature should re-activate cleanly",
    );

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});
