import { assertAlmostEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import {
  toActivation,
  toValue,
} from "../../src/architecture/BackPropagation.ts";
import type { ActivationInterface } from "../../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../../src/methods/activations/Activations.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "CLIPPED", bias: 2.5 },
      { type: "hidden", uuid: "hidden-3b", squash: "INVERSE", bias: -0.1 },
      { type: "hidden", uuid: "hidden-4", squash: "IF", bias: 0 },

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
      {
        fromUUID: "input-0",
        toUUID: "hidden-4",
        weight: -0.3,
        type: "condition",
      },
      { fromUUID: "hidden-3", toUUID: "hidden-3b", weight: 0.3 },
      {
        fromUUID: "hidden-3",
        toUUID: "hidden-4",
        weight: 0.3,
        type: "positive",
      },

      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "hidden-3b",
        toUUID: "hidden-4",
        weight: 0.3,
        type: "negative",
      },

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

Deno.test("toValue", () => {
  const creature = makeCreature();
  const neuron = creature.neurons[3];

  const activations = [0.3, -0.3, 1.3, -1.6, 0, 7, -8, 1];
  Activations.NAMES.forEach((name) => {
    neuron.setSquash(name);

    const squash = neuron.findSquash();
    if ((squash as ActivationInterface).squash) {
      for (let i = 0; i < activations.length; i++) {
        let expected = activations[i];
        const range = squash.range;
        if (expected > range.high) expected = range.high;
        if (expected < range.low) expected = range.low;

        const value = toValue(neuron, expected);

        const actualActivation = toActivation(neuron, value);

        const value2 = toValue(neuron, actualActivation, value);

        assertAlmostEquals(
          value,
          value2,
          0.1,
          `${i}: Squash: ${neuron.squash}, Expected: ${value} Actual: ${value2}`,
        );
      }
    }
  });
});
