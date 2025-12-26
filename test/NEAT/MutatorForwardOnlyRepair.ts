import { assert } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

Deno.test(
  "Mutator: in forward-only runs, fixes SELF_CONNECTION for pre-4.x creatures and upgrades to 4.x",
  () => {
    const config = createNeatConfig({
      feedbackLoop: false,
    });
    const mutator = new Mutator(config);

    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.forwardOnly = true;
    creature.semanticVersion = "2.0.0";

    // Inject corruption: self-loop on first hidden neuron.
    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    // Trigger the forward-only validation path by running a harmless mutation.
    mutator.mutateCreature(creature, { name: "MOD_WEIGHT" }, undefined);

    creature.validate({ forwardOnly: true });
    assert(
      creature.semanticVersion.startsWith("4."),
      `Expected creature to be upgraded to 4.x, got ${creature.semanticVersion}`,
    );
  },
);
