import { assert, assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 3 },
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

function makeMum() {
  const creature = makeCreature();
  creature.score = -0.1;
  creature.memetic = {
    generation: 1,
    weights: {},
    biases: {
      "hidden-3": 3.1,
      "hidden-4": 2.1,
    },
    score: -0.2,
  };

  creature.fix();
  creature.validate();
  return creature;
}

function makeDad() {
  const creature = makeCreature();
  creature.neurons[3].bias = -0.12;
  creature.synapses[2].weight = 0.456;
  creature.score = -0.2;
  creature.fix();
  creature.validate();
  return creature;
}

Deno.test("memetic preserved", () => {
  const mum = makeMum();
  assert(mum.memetic, "Should have memetic");
  const dad = makeDad();

  for (let i = 0; i < 12; i++) {
    const child = Offspring.breed(mum, dad);
    if (child !== undefined) {
      assert(child.memetic, "Child should have kept memetic");

      const childExport = child.exportJSON();
      console.log(JSON.stringify(childExport, null, 2));
      const synapse = childExport.synapses.find((s) =>
        s.fromUUID === "input-2" && s.toUUID === "output-1"
      );

      assert(synapse, "Synapse should exist");
      if (synapse.weight === 0.456) {
        const input2Weights = child.memetic.weights["input-2"];
        assert(input2Weights, "Should have previous weight");
        const output1Weight = input2Weights.find((w) =>
          w.toUUID === "output-1"
        );
        assert(output1Weight !== undefined, "Should have previous weight");
        assertAlmostEquals(
          output1Weight.weight,
          0.8,
          0.000001,
          "Should have kept previous weight",
        );
      }
    }
  }
});
