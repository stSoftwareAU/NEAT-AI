import { assert } from "@std/assert";
import { Creature, Mutation } from "../../mod.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

Deno.test("Mutator: feedbackLoop=true must not corrupt semanticVersion 4.x forward-only creatures", () => {
  // Arrange: a forward-only 4.x creature.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Configure mutator to only try adding back connections.
  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: true,
      // Keep it deterministic: only one mutation method in the list.
      mutationRate: 1,
      mutationAmount: 1,
      mutation: [Mutation.ADD_BACK_CONN],
    }),
  );

  // Act: attempt mutation.
  mutator.mutate([creature]);

  // Assert: still forward-only valid after mutation attempt.
  creature.validate({ forwardOnly: true });
});


