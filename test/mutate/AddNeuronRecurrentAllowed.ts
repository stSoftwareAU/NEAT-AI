import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { pickOutwardTargetNeuronIndex } from "../../src/mutate/AddNeuron.ts";

/**
 * Regression coverage: recurring connections (including self-loops) are valid
 * when a creature is **not** marked as forward-only.
 */
Deno.test("AddNeuron: recurring targets are allowed when creature is not forward-only", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });

  // Default validation allows recurrent connections.
  creature.validate();

  // In recurrent-capable mode (forwardOnly is undefined), it is valid to target
  // the same neuron index (self-loop).
  assertEquals(creature.forwardOnly, undefined);
  assertEquals(
    pickOutwardTargetNeuronIndex(creature, 2, 2),
    2,
  );

  // Edge case: caller may not have found a 'to' index.
  assertEquals(
    pickOutwardTargetNeuronIndex(creature, 2, -1),
    -1,
  );

  // In forward-only mode, we must never select a self-loop target.
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });
  assertEquals(
    pickOutwardTargetNeuronIndex(creature, 2, 2),
    3,
  );

  // Edge case: even with a supplied toIndex, no valid target may exist once we
  // apply the forward-only constraint (minTargetIndex > max index).
  const lastIndex = creature.neurons.length - 1;
  assertEquals(
    pickOutwardTargetNeuronIndex(creature, lastIndex, lastIndex),
    -1,
  );
});
