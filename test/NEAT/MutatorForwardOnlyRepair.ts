import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { Mutator } from "@neat/Mutator.ts";

Deno.test(
  "Mutator: forward-only run fixes injected SELF_CONNECTION",
  () => {
    const config = createNeatConfig({
      feedbackLoop: false,
    });
    const mutator = new Mutator(config);

    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    assertEquals(creature.forwardOnly, true);

    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    mutator.mutateCreature(creature, { name: "MOD_WEIGHT" }, undefined);
    mutator.repairAfterMutation(creature);

    creature.validate({ forwardOnly: true });
  },
);
