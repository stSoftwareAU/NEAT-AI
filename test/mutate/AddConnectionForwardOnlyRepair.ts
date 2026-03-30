import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

// cspell:ignore TESTDISC

/**
 * Issue #1584: Validation is no longer performed inside AddConnection.
 * Instead, Mutator.repairAfterMutation() handles fix + validate after the
 * full mutation batch. These tests verify that the Mutator correctly repairs
 * forward-only creatures that start with invalid synapses.
 */

Deno.test(
  "Mutator: forwardOnly repairs self/back connections",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    assert(creature.forwardOnly === true);

    const hiddenIndex = creature.input;
    assert(hiddenIndex < creature.neurons.length - creature.output);

    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
    });
    const mutator = new Mutator(config);
    mutator.repairAfterMutation(creature);

    creature.validate({ forwardOnly: true });
    assertEquals(creature.forwardOnly, true);
  },
);
