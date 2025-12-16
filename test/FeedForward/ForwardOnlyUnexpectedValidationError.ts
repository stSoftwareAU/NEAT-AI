import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("Forward-only: unexpected validation errors are re-thrown during mutation", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  assert(creature.synapses.length > 0, "Test requires at least one synapse");

  // Force forward-only validation path (feedbackLoop unset/false).
  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    }),
  );

  // Inject a validation failure that is NOT SELF_CONNECTION or RECURSIVE_SYNAPSE.
  // This simulates any other structural failure (e.g. NO_INWARD_CONNECTIONS, MEMETIC).
  (creature as unknown as { validate: () => void }).validate = () => {
    const err = new Error("Injected validation error");
    err.name = "MEMETIC";
    throw err;
  };

  let thrown: Error | undefined;
  try {
    mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
  } catch (e) {
    thrown = e as Error;
  }

  assert(thrown, "Expected mutateCreature() to throw");
  assertEquals(thrown.name, "MEMETIC");
  assertEquals(thrown.message, "Injected validation error");
});
