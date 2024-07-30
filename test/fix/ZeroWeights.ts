import { Creature, type CreatureExport } from "../../mod.ts";
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: 0 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0 },

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

Deno.test("Remove zero weights", () => {
  const creature = makeCreature();

  creature.fix();

  creature.synapses.forEach((synapse) => {
    assert(
      synapse.weight,
      `Synapse ${synapse.from}->${synapse.to} should not be zero`,
    );
  });
});
