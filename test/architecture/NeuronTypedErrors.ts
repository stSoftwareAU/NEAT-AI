/**
 * Tests verifying Neuron stub methods throw typed TopologyError
 * instead of generic Error.
 *
 * Issue #1694
 */
import { assertIsError, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { TopologyError } from "@errors/TopologyError.ts";

Deno.test("Neuron activateNeuron - throws TopologyError for unimplemented", () => {
  const creature = new Creature(2, 1);
  // Hidden neurons have real implementations; the base Neuron stubs throw.
  // Access a neuron and call the base stub directly.
  const neuron = creature.neurons[0];
  const err = assertThrows(() => neuron.activateNeuron());
  assertIsError(err, TopologyError);
});

Deno.test("Neuron activateAndTraceNeuron - throws TopologyError for unimplemented", () => {
  const creature = new Creature(2, 1);
  const neuron = creature.neurons[0];
  const err = assertThrows(() => neuron.activateAndTraceNeuron());
  assertIsError(err, TopologyError);
});
