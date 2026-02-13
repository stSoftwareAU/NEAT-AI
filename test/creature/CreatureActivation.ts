/**
 * Tests for CreatureActivation module.
 * Verifies WASM activation, eligibility checking, and disposal.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import {
  disposeWasm,
  getUnsupportedWasmSquashFunctions,
  isWasmEligible,
  requireWasmOrThrow,
} from "../../src/creature/CreatureActivation.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("isWasmEligible - standard creature is WASM-eligible", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  const eligible = isWasmEligible(creature);
  assert(eligible, "Standard creature should be WASM-eligible");
});

Deno.test("isWasmEligible - via facade", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  assertEquals(
    isWasmEligible(creature),
    creature.isWasmEligible(),
    "Facade and module should agree on WASM eligibility",
  );
});

Deno.test("getUnsupportedWasmSquashFunctions - returns empty for standard creature", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  const unsupported = getUnsupportedWasmSquashFunctions(creature);
  assertEquals(
    unsupported.length,
    0,
    "Standard creature should have no unsupported squash functions",
  );
});

Deno.test("requireWasmOrThrow - does not throw for eligible creature", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  // Should not throw
  requireWasmOrThrow(creature);
});

Deno.test("disposeWasm - cleans up WASM state", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Activate once to populate WASM cache
  creature.activate(new Float32Array([0.5, 0.5]));

  // Dispose should clean up
  disposeWasm(creature);
  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "WASM activation should be disposed",
  );
  assertEquals(
    creature.wasmEligibilityCache,
    undefined,
    "WASM eligibility cache should be cleared",
  );
});

Deno.test("activate - produces consistent output", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  const input = new Float32Array([0.3, 0.7]);
  const out1 = creature.activate(input);
  const out2 = creature.activate(input);

  assertEquals(out1.length, 1, "Should have 1 output");
  assertEquals(out2.length, 1, "Should have 1 output");
  // Forward-only creature should produce same output for same input
  if (creature.forwardOnly) {
    assertEquals(out1[0], out2[0], "Same input should produce same output");
  }
});

Deno.test("activate - rejects non-finite input", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  assertThrows(
    () => creature.activate(new Float32Array([NaN, 0.5])),
    Error,
    "finite number",
    "Should reject NaN input",
  );

  assertThrows(
    () => creature.activate(new Float32Array([Infinity, 0.5])),
    Error,
    "finite number",
    "Should reject Infinity input",
  );
});
