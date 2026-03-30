import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

/**
 * repairAfterMutation() runs fix() only — it does not call creature.validate().
 * Forward-only correctness is enforced by mutation + fix; callers/tests opt in
 * to validate() when they need to assert structure.
 */
Deno.test("Forward-only: repairAfterMutation completes and creature validates when checked", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  assert(creature.synapses.length > 0, "Test requires at least one synapse");

  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
  mutator.repairAfterMutation(creature);

  creature.validate({ forwardOnly: true });
});
