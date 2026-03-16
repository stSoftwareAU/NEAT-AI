/**
 * Issue #1584: Verify AddConnection correctness for forward-only creatures
 * and full mutation batch workflows.
 */
import { assert } from "@std/assert";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

Deno.test(
  "Mutator: full mutation batch produces valid forward-only creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
      mutationAmount: 5,
    });
    const mutator = new Mutator(config);

    // Create a population of forward-only creatures.
    const pop: Creature[] = [];
    for (let i = 0; i < 20; i++) {
      const c = new Creature(5, 3, { layers: [{ count: 5 }] });
      c.forwardOnly = true;
      pop.push(c);
    }

    mutator.mutate(pop);

    // Every creature must be valid after mutation.
    for (const creature of pop) {
      creatureValidate(creature);
      // Forward-only invariant: no recurrent synapses.
      for (const synapse of creature.synapses) {
        assert(
          synapse.from < synapse.to,
          `Forward-only violation after mutation batch: ${synapse.from} -> ${synapse.to}`,
        );
      }
    }
  },
);
