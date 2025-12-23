import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

/**
 * Regression coverage: forward-only creatures must not gain recurrent connections
 * (self-loops or feedback/backward connections) during structural mutations.
 */
Deno.test("Forward-only: AddNeuron does not introduce recurrent connections", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const beforeNeurons = creature.neurons.length;
  const beforeSynapses = creature.synapses.length;

  const addNeuron = new AddNeuron(creature);
  const changed = addNeuron.mutate();

  assertEquals(changed, true);
  assertEquals(creature.neurons.length, beforeNeurons + 1);
  assertEquals(creature.synapses.length > beforeSynapses, true);

  // This is the hard invariant we care about.
  creature.validate({ forwardOnly: true });
});
