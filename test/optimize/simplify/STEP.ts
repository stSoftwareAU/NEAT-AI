import { assert, fail } from "@std/assert";
import { Creature, type CreatureExport } from "../../../mod.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { makeData } from "./ABSOLUTE.ts";
import type { NeuronExport } from "../../../src/architecture/NeuronInterfaces.ts";

// Mock setup for a neural network with redundant STEP neurons
Deno.test("simply STEP", () => {
  const directory = ".test/optimize/simplify/STEP";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      { uuid: "step-1", type: "hidden", squash: STEP.NAME, bias: 0 },
      { uuid: "step-2", type: "hidden", squash: STEP.NAME, bias: 0 },
      { uuid: "step-combined", type: "hidden", squash: STEP.NAME, bias: -1.5 },

      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],

    synapses: [
      { fromUUID: "input-0", toUUID: "step-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "step-2", weight: 1 },
      { fromUUID: "step-1", toUUID: "step-combined", weight: 1 },
      { fromUUID: "step-2", toUUID: "step-combined", weight: 1 },
      { fromUUID: "step-combined", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  };
  const complex = Creature.fromJSON(json);
  complex.validate();

  const exportCreature = complex.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(exportCreature, null, 1),
  );
  const simplifiedCreature = simplify(complex);
  assert(simplifiedCreature);
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedCreature.exportJSON(), null, 1),
  );

  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );

  Deno.writeTextFileSync(
    `${directory}/inline-simplied.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );
  for (let p = 0; p < 100; p++) {
    const data = makeData(p, complex.input);

    const actual1 = complex.activate(data, false)[0];
    const actual2 = simplifiedCreature.activate(data, false)[0];

    if (Math.abs(actual1 - actual2) > 0.000_000_1) {
      fail(
        `${p}) expected: ${actual1} actual: ${actual2}, delta: ${
          Math.abs(actual1 - actual2)
        }, data: ${data}`,
      );
    }
  }
});

Deno.test("scan single synapse", () => {
  const exported = JSON.parse(
    Deno.readTextFileSync("../GRQ-cluster/network.json"),
  ) as CreatureExport;

  const neuronMap = new Map<string, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronMap.set(neuron.uuid, neuron);
  });
  const synapseMap = new Map<string, Set<string>>();
  exported.synapses.forEach((synapse) => {
    let set = synapseMap.get(synapse.fromUUID);
    if (!set) {
      set = new Set<string>();
      synapseMap.set(synapse.fromUUID, set);
    }
    set.add(synapse.toUUID);
  });

  synapseMap.forEach((set, fromUUID) => {
    if (set.size == 1) {
      const squash = neuronMap.get(fromUUID)?.squash;
      console.log(
        `${fromUUID} ${squash ? squash : ""} -> ${Array.from(set)[0]} ${
          neuronMap.get(Array.from(set)[0])?.squash
        }`,
      );
    }
  });
});
