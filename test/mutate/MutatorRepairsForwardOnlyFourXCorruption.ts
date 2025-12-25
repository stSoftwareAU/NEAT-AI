import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";

/**
 * Regression coverage for https://github.com/stSoftwareAU/NEAT-AI/issues/955
 *
 * The historic failure mode was that `AddConnection` used `neuron.index` fields
 * when creating a synapse. If those indices are corrupted, `ADD_CONN` can
 * accidentally create a backward connection (from > to) even though it enumerates
 * feed-forward (fromIndx < toIndx) pairs.
 *
 * This test corrupts `neuron.index` to reproduce the bug deterministically and
 * asserts `AddConnection` still creates the correct forward-only connection.
 */
Deno.test("AddConnection: forward-only throws if the creature already contains a recurrent synapse", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  const hiddenIndex = creature.input;
  const outputIndex = creature.neurons.length - 1;

  // Inject a backward (recurrent) synapse with valid indices.
  creature.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.5));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // Ensure there is at least one missing eligible forward connection so
  // AddConnection actually mutates.
  creature.disconnect(0, hiddenIndex);

  const add = new AddConnection(creature);
  assertThrows(() => add.mutate());

  // Sanity: the creature is indeed invalid forward-only due to the injected synapse.
  assertEquals(creature.getSynapse(outputIndex, hiddenIndex) !== null, true);
});

Deno.test("AddConnection: forward-only throws if neuron.index fields are inconsistent", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  // Corrupt the index metadata (this should never happen in real creatures).
  creature.neurons[creature.input].index = creature.input + 1;

  const add = new AddConnection(creature);
  assertThrows(() => add.mutate());
});
