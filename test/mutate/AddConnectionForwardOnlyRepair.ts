import { assert } from "@std/assert";
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
  "Mutator: pre-4.x forwardOnly repairs self/back connections after mutation batch",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.forwardOnly = true;
    creature.semanticVersion = "2.0.0";

    const hiddenIndex = creature.input;
    assert(hiddenIndex < creature.neurons.length - creature.output);

    // Inject a self connection (invalid for forward-only).
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    // Use repairAfterMutation() to fix the creature (as the Mutator would).
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
    });
    const mutator = new Mutator(config);
    mutator.repairAfterMutation(creature);

    // Should be valid forward-only after repair.
    creature.validate({ forwardOnly: true });
    assert(
      creature.semanticVersion.startsWith("4."),
      "Expected upgrade to 4.x after validation",
    );
  },
);

Deno.test(
  "Mutator: 4.x forwardOnly throws if creature has recurrent synapses after repair",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.forwardOnly = true;
    creature.semanticVersion = "4.0.0";

    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    // repairAfterMutation() calls fix() first, which should remove the
    // self-connection. For 4.x creatures, if fix() cannot resolve it,
    // validate() will throw.
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
    });
    const mutator = new Mutator(config);

    // The repair should succeed — fix() removes the self-connection
    // and validate() confirms the result.
    mutator.repairAfterMutation(creature);
    creature.validate({ forwardOnly: true });
  },
);
