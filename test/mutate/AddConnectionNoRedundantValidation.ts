/**
 * Issue #1584: Verify AddConnection correctness for forward-only creatures
 * and full mutation batch workflows.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

function createForwardOnlyCreature(): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: 0.2,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.4 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.forwardOnly = true;
  return creature;
}

Deno.test(
  "AddConnection: forward-only creature adds only forward connections",
  () => {
    const creature = createForwardOnlyCreature();

    let added = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const clone = Creature.fromJSON(creature.exportJSON());
      clone.forwardOnly = true;
      const cloneAddConn = new AddConnection(clone);

      if (cloneAddConn.mutate()) {
        added = true;
        // All synapses must be forward-only (from < to).
        for (const synapse of clone.synapses) {
          assert(
            synapse.from < synapse.to,
            `Forward-only violation: ${synapse.from} -> ${synapse.to}`,
          );
        }
      }
    }

    assert(added, "Should add at least one connection");
  },
);

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

Deno.test(
  "AddConnection: standalone call adds a connection and creature remains valid",
  () => {
    const creature = createForwardOnlyCreature();
    const synapseCountBefore = creature.synapses.length;

    const addConn = new AddConnection(creature);
    let added = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (addConn.mutate()) {
        added = true;
        break;
      }
    }

    assert(added, "Should add a connection");
    assert(
      creature.synapses.length > synapseCountBefore,
      "Synapse count should increase",
    );

    // The creature is still structurally valid even without internal validate()
    // because AddConnection only adds forward connections.
    creatureValidate(creature);
  },
);

Deno.test(
  "AddConnection: memetic flag cleared after successful mutation",
  () => {
    const creature = createForwardOnlyCreature();
    creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };

    const addConn = new AddConnection(creature);
    let added = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (addConn.mutate()) {
        added = true;
        break;
      }
    }

    assert(added, "Should add a connection");
    assertEquals(
      creature.memetic,
      undefined,
      "Memetic flag should be cleared after mutation",
    );
  },
);
