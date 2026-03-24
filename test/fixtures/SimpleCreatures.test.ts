/**
 * Tests for the shared creature fixture factories.
 *
 * Verifies that each factory produces a valid creature with the
 * expected topology (inputs, outputs, neurons, synapses).
 */
import { assert, assertEquals } from "@std/assert";
import {
  makeBaseCreature,
  makeForwardOnlyCreature,
  makeSimpleCreature,
} from "./SimpleCreatures.ts";

Deno.test("makeSimpleCreature returns a valid 2-input, 1-output creature", () => {
  const creature = makeSimpleCreature();
  creature.validate();

  assertEquals(creature.input, 2, "should have 2 inputs");
  assertEquals(creature.output, 1, "should have 1 output");

  const json = creature.exportJSON();
  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  const outputNeurons = json.neurons.filter((n) => n.type === "output");
  assertEquals(hiddenNeurons.length, 1, "should have 1 hidden neuron");
  assertEquals(outputNeurons.length, 1, "should have 1 output neuron");
  assertEquals(hiddenNeurons[0].squash, "IDENTITY");
  assertEquals(outputNeurons[0].squash, "IDENTITY");

  assertEquals(json.synapses.length, 2, "should have 2 synapses");
  assert(creature.uuid, "should have a UUID assigned");
});

Deno.test("makeSimpleCreature returns distinct instances", () => {
  const a = makeSimpleCreature();
  const b = makeSimpleCreature();
  assert(a !== b, "each call should return a new creature");
});

Deno.test("makeBaseCreature returns a valid 2-input, 1-output creature with 3 synapses", () => {
  const creature = makeBaseCreature();
  creature.validate();

  assertEquals(creature.input, 2, "should have 2 inputs");
  assertEquals(creature.output, 1, "should have 1 output");

  const json = creature.exportJSON();
  assertEquals(json.synapses.length, 3, "should have 3 synapses");

  // Verify the direct input-1 → output-0 connection exists
  const directSynapse = json.synapses.find(
    (s) => s.fromId === 1 && s.toId === -1,
  );
  assert(directSynapse, "should have a direct input-1 → output-0 synapse");
  assertEquals(directSynapse.weight, -0.25);
  assert(creature.uuid, "should have a UUID assigned");
});

Deno.test("makeForwardOnlyCreature returns a valid 1-input, 1-output forward-only creature", () => {
  const creature = makeForwardOnlyCreature();
  creature.validate();

  assertEquals(creature.input, 1, "should have 1 input");
  assertEquals(creature.output, 1, "should have 1 output");

  const json = creature.exportJSON();
  const hiddenNeurons = json.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 1, "should have 1 hidden neuron");
  assertEquals(
    hiddenNeurons[0].bias,
    0.1,
    "hidden neuron should have bias 0.1",
  );
  assertEquals(json.synapses.length, 2, "should have 2 synapses");
});
