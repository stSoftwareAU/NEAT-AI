/**
 * Issue #1762 - Backwards compatibility tests for deprecated squash types.
 *
 * HYPOT, HYPOTv2, and MEAN are deprecated aggregate squash functions that
 * must remain in the SquashType enum for backwards compatibility with
 * serialised creatures. These tests verify that old creatures referencing
 * these squash types can still be loaded and upgraded.
 *
 * @module
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { getSquashType, SquashType } from "../../src/wasm/SquashType.ts";
import { Activations } from "../../src/methods/activations/Activations.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("Deprecated squash types resolve to correct enum values", () => {
  // These must remain mapped for backwards compatibility with serialised creatures
  assertEquals(getSquashType("HYPOT"), SquashType.Hypotenuse);
  assertEquals(getSquashType("HYPOTv2"), SquashType.HypotenuseV2);
  assertEquals(getSquashType("MEAN"), SquashType.Mean);
});

Deno.test("Deprecated squash types have stable numeric values", () => {
  // Enum values must not change — they are baked into serialised WASM data
  assertEquals(SquashType.Hypotenuse, 35);
  assertEquals(SquashType.HypotenuseV2, 36);
  assertEquals(SquashType.Mean, 37);
});

Deno.test("Deprecated activation functions are findable via Activations", () => {
  // Old creatures may reference these squash names during deserialisation
  const hypot = Activations.find("HYPOT");
  assertNotEquals(
    hypot,
    undefined,
    "HYPOT must be findable for loading old creatures",
  );

  const hypotV2 = Activations.find("HYPOTv2");
  assertNotEquals(
    hypotV2,
    undefined,
    "HYPOTv2 must be findable for loading old creatures",
  );

  const mean = Activations.find("MEAN");
  assertNotEquals(
    mean,
    undefined,
    "MEAN must be findable for loading old creatures",
  );
});

Deno.test("Deprecated activation functions have zero mutation probability", () => {
  // Deprecated functions must not be randomly selected during evolution
  const hypot = Activations.find("HYPOT");
  assertEquals(
    hypot.mutationProbability,
    0,
    "HYPOT should never be selected by mutation",
  );

  const hypotV2 = Activations.find("HYPOTv2");
  assertEquals(
    hypotV2.mutationProbability,
    0,
    "HYPOTv2 should never be selected by mutation",
  );

  const mean = Activations.find("MEAN");
  assertEquals(
    mean.mutationProbability,
    0,
    "MEAN should never be selected by mutation",
  );
});

Deno.test("Creature with deprecated MEAN squash can be loaded from JSON", () => {
  // Simulates loading a serialised creature that uses the deprecated MEAN squash
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "MEAN", index: 2 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 2, weight: 0.3 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const result = creature.activate(new Float32Array([1.0, 0.5]));
  assertEquals(
    result.length,
    1,
    "Should produce output from deprecated MEAN creature",
  );
});
