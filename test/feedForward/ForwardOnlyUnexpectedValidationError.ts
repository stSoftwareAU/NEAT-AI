import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

/**
 * repairAfterMutation() calls fix() only — not validate() (Issue #1583).
 * Unexpected errors thrown by fix() must still propagate to the caller.
 */
Deno.test("Forward-only: unexpected fix errors are re-thrown from repairAfterMutation", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  assert(creature.synapses.length > 0, "Test requires at least one synapse");

  // Force forward-only path (feedbackLoop unset/false).
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

  // Inject an unexpected error into fix() — repairAfterMutation() calls
  // creature.fix({ forwardOnly: true }) so the error should propagate.
  creature.fix = () => {
    const err = new Error("Injected fix error");
    err.name = "MEMETIC";
    throw err;
  };

  let thrown: Error | undefined;
  try {
    mutator.repairAfterMutation(creature);
  } catch (e) {
    thrown = e as Error;
  }

  assert(thrown, "Expected repairAfterMutation() to throw");
  assertEquals(thrown.name, "MEMETIC");
  assertEquals(thrown.message, "Injected fix error");
});
