import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("Forward-only: self-connection is repaired on mutate", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-0", weight: 0.25 }, // illegal self connection
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const creature = Creature.fromJSON(json);
  assertEquals(creature.forwardOnly, true);

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false, // forward-only run
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  // Issue #1583: fix/validate batched — repairAfterMutation removes
  // self-connections via fix({ forwardOnly: true }).
  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
  mutator.repairAfterMutation(creature);

  // Must remain forward-only and have no self/back connections after repair.
  assertEquals(creature.forwardOnly, true);
  creature.validate({ forwardOnly: true });

  // Verify the self-connection was removed.
  for (const synapse of creature.synapses) {
    assert(
      synapse.from !== synapse.to,
      `Self-connection should have been removed: ${synapse.from}`,
    );
  }
});

Deno.test("FeedbackLoop enabled does not clear forwardOnly on mutate", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: true,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
  assertEquals(creature.forwardOnly, true);
});
