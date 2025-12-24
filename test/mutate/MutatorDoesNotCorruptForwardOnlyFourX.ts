import { Creature, Mutation } from "../../mod.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { assertThrows } from "@std/assert";

Deno.test("Mutator: selectMutationMethod must not infinite-loop when only disallowed mutations are configured", () => {
  // Arrange: a forward-only 4.x creature.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Configure mutator to only try adding back connections.
  // This is disallowed for forward-only creatures; selection must fail fast.
  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: true,
      // Keep it deterministic: only one mutation method in the list.
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.ADD_BACK_CONN],
    }),
  );

  // Act/Assert: selection should throw (not hang).
  assertThrows(() => mutator.selectMutationMethod(creature));
});
