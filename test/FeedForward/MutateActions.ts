import { Creature, type CreatureExport, Mutation } from "../../mod.ts";
import { NeatConfig } from "../../src/config/NeatConfig.ts";
import type { MutationInterface } from "../../src/NEAT/MutationInterface.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { assert } from "@std/assert";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 2 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("FeedForward only", () => {
  const creature = makeCreature();

  const config = new NeatConfig({});
  const mutator = new Mutator(config);

  for (let i = 0; i < 100; i++) {
    const method: MutationInterface = mutator.selectMutationMethod(creature);

    if (
      method.name == Mutation.ADD_SELF_CONN.name ||
      method.name == Mutation.SUB_BACK_CONN.name ||
      method.name == Mutation.SUB_SELF_CONN.name ||
      method.name == Mutation.ADD_BACK_CONN.name
    ) {
      throw new Error(`Invalid mutation: ${method.name}`);
    }
  }
});

Deno.test("memory enabled", () => {
  const creature = makeCreature();

  const config = new NeatConfig({ feedbackLoop: true, mutation: Mutation.ALL });
  const mutator = new Mutator(config);

  let found = false;
  for (let i = 0; i < 100; i++) {
    const method: MutationInterface = mutator.selectMutationMethod(creature);

    if (
      method.name == Mutation.ADD_SELF_CONN.name ||
      method.name == Mutation.SUB_BACK_CONN.name ||
      method.name == Mutation.SUB_SELF_CONN.name ||
      method.name == Mutation.ADD_BACK_CONN.name
    ) {
      found = true;
      break;
    }
  }
  assert(found, "No back connection methods found");
});
