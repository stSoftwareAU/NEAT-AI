import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Regression coverage for https://github.com/stSoftwareAU/NEAT-AI/issues/955
 *
 * The historic failure mode was that `AddConnection` used `neuron.index` fields
 * when creating a synapse. If those indices are corrupted, `ADD_CONN` can
 * accidentally create a backward connection (from > to) even though it enumerates
 * feed-forward (fromIndx < toIndx) pairs.
 *
 * Issue #1584: Validation was moved from AddConnection to
 * Mutator.repairAfterMutation(). The Mutator now handles forward-only
 * validation and repair after the full mutation batch.
 */
Deno.test("Mutator: forward-only 4.x repairs recurrent synapses via fix then validate", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  creature.semanticVersion = "4.0.0";

  const hiddenIndex = creature.input;
  const outputIndex = creature.neurons.length - 1;

  // Inject a backward (recurrent) synapse with valid indices.
  creature.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.5));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  const config = createNeatConfig({
    mutation: Mutation.FFW,
    mutationRate: 1.0,
  });
  const mutator = new Mutator(config);

  // repairAfterMutation() calls fix({ forwardOnly: true }) which removes the
  // recurrent synapse, then validate() confirms the creature is valid.
  mutator.repairAfterMutation(creature);

  // Creature should now be valid forward-only.
  creature.validate({ forwardOnly: true });

  // The recurrent synapse should have been removed.
  assertEquals(creature.getSynapse(outputIndex, hiddenIndex), null);
});

Deno.test("AddConnection: forward-only throws if neuron.index fields are inconsistent", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  // Corrupt the index metadata (this should never happen in real creatures).
  creature.neurons[creature.input].index = creature.input + 1;

  const add = new AddConnection(creature);
  assertThrows(() => add.mutate());
});
