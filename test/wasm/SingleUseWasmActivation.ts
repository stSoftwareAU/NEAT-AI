/**
 * SingleUseWasmActivation Unit Tests
 *
 * Issue #1504 - Reduce WASM CompiledNetwork memory retention after creature.activate()
 *
 * Verifies:
 * 1. Single-use activation mode disposes WASM after activate()
 * 2. Single-use mode still produces correct activation results
 * 3. getCachedWasmActivationCount() returns accurate counts
 * 4. Single-use mode works with multiple sequential activations
 */

import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "../../src/wasm/WasmCreatureActivationLRU.ts";
// Side-effect import to trigger WASM auto-initialisation
import "../../src/wasm/WasmAutoInit.ts";

/**
 * Create a minimal creature for testing.
 */
function createTestCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();
  return creature;
}

// ---------------------------------------------------------------------------
// getCachedWasmActivationCount tests
// ---------------------------------------------------------------------------

Deno.test("SingleUseWasm: getCachedWasmActivationCount returns a number", () => {
  const count = getCachedWasmActivationCount();
  assertEquals(typeof count, "number");
});

Deno.test("SingleUseWasm: getCachedWasmActivationCount increases after activate", () => {
  const original = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(512);

    const creature = createTestCreature();
    const input = new Float32Array([0.5, 0.3]);

    const countBefore = getCachedWasmActivationCount();
    creature.activate(input);
    const countAfter = getCachedWasmActivationCount();

    assertGreater(
      countAfter,
      countBefore,
      "Cache count should increase after activation",
    );

    creature.dispose();
  } finally {
    setMaxCachedWasmCreatureActivations(original);
  }
});

// ---------------------------------------------------------------------------
// Single-use activation mode tests
// ---------------------------------------------------------------------------

Deno.test("SingleUseWasm: activateSingleUse disposes WASM after activation", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);

  // Activate in single-use mode
  const result = creature.activateSingleUse(input);

  // Should produce valid output
  assertEquals(result.length, 1, "Should return output of correct length");
  assertEquals(
    Number.isFinite(result[0]),
    true,
    "Output should be a finite number",
  );

  // WASM should be disposed after single-use activation
  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "cachedWasmActivation should be undefined after single-use activation",
  );

  creature.dispose();
});

Deno.test("SingleUseWasm: activateSingleUse produces same results as activate", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);

  // Normal activation
  const normalResult = creature.activate(input);

  // Dispose and re-activate in single-use mode
  creature.disposeWasm();
  const singleUseResult = creature.activateSingleUse(input);

  // Results should match
  assertEquals(
    normalResult.length,
    singleUseResult.length,
    "Output lengths should match",
  );
  for (let i = 0; i < normalResult.length; i++) {
    assertEquals(
      normalResult[i],
      singleUseResult[i],
      `Output at index ${i} should match`,
    );
  }

  creature.dispose();
});

Deno.test("SingleUseWasm: multiple sequential single-use activations work", () => {
  const creature = createTestCreature();

  const inputs = [
    new Float32Array([0.1, 0.2]),
    new Float32Array([0.3, 0.4]),
    new Float32Array([0.5, 0.6]),
  ];

  for (const input of inputs) {
    const result = creature.activateSingleUse(input);
    assertEquals(result.length, 1, "Each activation should produce output");
    assertEquals(
      Number.isFinite(result[0]),
      true,
      "Each output should be finite",
    );

    // WASM should be disposed after each call
    assertEquals(
      creature.cachedWasmActivation,
      undefined,
      "WASM should be disposed after each single-use activation",
    );
  }

  creature.dispose();
});

Deno.test("SingleUseWasm: activateSingleUse with feedbackLoop parameter", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);

  // Should accept feedbackLoop parameter
  const result = creature.activateSingleUse(input, false);
  assertEquals(
    result.length,
    1,
    "Should return output with feedbackLoop=false",
  );

  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "WASM should be disposed after single-use activation with feedbackLoop",
  );

  creature.dispose();
});

Deno.test("SingleUseWasm: activateSingleUse validates input", () => {
  const creature = createTestCreature();
  const badInput = new Float32Array([NaN, 0.3]);

  let threw = false;
  try {
    creature.activateSingleUse(badInput);
  } catch {
    threw = true;
  }

  assertEquals(threw, true, "Should throw on non-finite input");

  // WASM should still be cleaned up even after error
  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "WASM should be undefined after failed single-use activation",
  );

  creature.dispose();
});
