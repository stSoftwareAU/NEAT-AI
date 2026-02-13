/**
 * Tests for CreatureSerialization module.
 * Verifies exportJSON, traceJSON, loadFrom, fromJSON, and shallowClone
 * produce correct results when called via the Creature facade.
 */

import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import {
  exportJSON,
  fromJSON,
  loadFrom,
  shallowClone,
  traceJSON,
} from "../../src/creature/CreatureSerialization.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("exportJSON - produces valid CreatureExport", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  const json = exportJSON(creature);
  assertEquals(json.input, 2);
  assertEquals(json.output, 1);
  assert(json.neurons.length > 0, "Should have neurons");
  assert(json.synapses.length > 0, "Should have synapses");

  // Verify same result via facade
  const facadeJson = creature.exportJSON();
  assertEquals(
    JSON.stringify(json),
    JSON.stringify(facadeJson),
    "Module function and facade should produce identical output",
  );
});

Deno.test("traceJSON - includes trace data after activation", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  const json = creature.exportJSON();
  const bpConfig = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(json, bpConfig);

  creature.activateAndTrace(
    new Float32Array([0.5, 0.5]),
    false,
    sparseConfig,
  );

  const trace = traceJSON(creature);
  assertEquals(trace.input, 2);
  assertEquals(trace.output, 1);
});

Deno.test("fromJSON - round-trips correctly", async () => {
  await initWasmForTests();
  const original = new Creature(3, 2, {
    layers: [{ count: 3 }],
  });
  creatureValidate(original);

  const json = original.exportJSON();
  const restored = fromJSON(json, true, Creature);

  assertEquals(restored.input, original.input);
  assertEquals(restored.output, original.output);
  assertEquals(restored.neurons.length, original.neurons.length);
  assertEquals(restored.synapses.length, original.synapses.length);
  creatureValidate(restored);
});

Deno.test("fromJSON - via Creature.fromJSON static method", async () => {
  await initWasmForTests();
  const original = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  const json = original.exportJSON();

  const restored = Creature.fromJSON(json, true);
  assertEquals(restored.input, 2);
  assertEquals(restored.output, 1);
  creatureValidate(restored);

  // Activations should match
  const input = new Float32Array([0.3, 0.7]);
  const out1 = original.activate(input);
  const out2 = restored.activate(input);
  assertEquals(out1.length, out2.length);
  for (let i = 0; i < out1.length; i++) {
    assertEquals(out1[i], out2[i], `Output ${i} should match`);
  }
});

Deno.test("loadFrom - replaces creature content", async () => {
  await initWasmForTests();
  const source = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });
  const target = new Creature(2, 1, { lazyInitialization: true });

  const json = source.exportJSON();
  loadFrom(target, json, true);

  assertEquals(target.neurons.length, source.neurons.length);
  assertEquals(target.synapses.length, source.synapses.length);
  creatureValidate(target);
});

Deno.test("shallowClone - creates independent copy", async () => {
  await initWasmForTests();
  const original = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  original.score = 0.5;

  const clone = shallowClone(original, Creature);

  assertNotStrictEquals(clone, original, "Clone should be a different object");
  assertEquals(clone.input, original.input);
  assertEquals(clone.output, original.output);
  assertEquals(clone.neurons.length, original.neurons.length);
  assertEquals(clone.synapses.length, original.synapses.length);
  assertEquals(clone.score, original.score);
  creatureValidate(clone);

  // Verify independence - modifying clone doesn't affect original
  clone.score = 0.9;
  assertEquals(original.score, 0.5, "Original score should be unchanged");
});

Deno.test("shallowClone - via Creature facade method", async () => {
  await initWasmForTests();
  const original = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  const clone = original.shallowClone();

  assertNotStrictEquals(clone, original);
  assertEquals(clone.input, original.input);
  assertEquals(clone.output, original.output);
  assertEquals(clone.neurons.length, original.neurons.length);

  // Activations should match
  const input = new Float32Array([0.4, 0.6]);
  const out1 = original.activate(input);
  const out2 = clone.activate(input);
  for (let i = 0; i < out1.length; i++) {
    assertEquals(out1[i], out2[i]);
  }
});
