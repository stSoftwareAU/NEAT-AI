import { assert, fail } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { ABSOLUTE } from "../../src/methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { RELU } from "../../src/methods/activations/types/RELU.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-3",
        squash: LeakyReLU.NAME,
        bias: -0.002,
      },
      {
        type: "hidden",
        uuid: "hidden-4",
        squash: TANH.NAME,
        bias: Math.SQRT1_2,
      },

      {
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
        bias: -0.123,
      },
      {
        type: "output",
        squash: ABSOLUTE.NAME,
        uuid: "output-1",
        bias: 0.456,
      },
      {
        type: "output",
        squash: Mish.NAME,
        uuid: "output-2",
        bias: 0.345,
      },
    ],
    synapses: [
      { fromUUID: "input-33", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-50", toUUID: "hidden-4", weight: 0.3 },

      { fromUUID: "input-11", toUUID: "hidden-3", weight: -0.1 },
      { fromUUID: "input-22", toUUID: "hidden-4", weight: 0.2 },

      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-10", toUUID: "output-2", weight: -0.4 },
      { fromUUID: "hidden-4", toUUID: "output-2", weight: 0.13 },
    ],
    input: 100,
    output: 3,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeData(input: number) {
  const inputs: number[][] = [];

  for (let i = 1024; i--;) {
    const observations: number[] = [];
    for (let j = input; j--;) {
      observations.push(
        Math.random() * 2 - 1,
      );
    }
    inputs.push(observations);
  }
  return inputs;
}

Deno.test("Error-Driven Squash Discovery", async () => {
  const targetCreature = makeCreature();
  const data = makeData(targetCreature.input);

  /** Record the ideal outputs from the target creature */
  const trainingData: DataRecordInterface[] = [];

  for (let i = data.length; i--;) {
    const input = data[i];
    const output = targetCreature.activate(new Float32Array(input));

    trainingData.push({
      input,
      output: Array.from(output),
    });
  }

  /**
   * Create a "crippled" version by changing the squash function of a neuron
   * and adding a synapse to cause random noise.
   */
  const exportedJSON = targetCreature.exportJSON();
  exportedJSON.neurons.find((neuron) => neuron.uuid === "hidden-3")!.squash =
    TANH.NAME; // Change the squash function
  exportedJSON.synapses.push({
    fromUUID: "input-44",
    toUUID: "hidden-3",
    weight: 0.000_001,
  });

  const crippledCreature = Creature.fromJSON(exportedJSON);
  CreatureUtil.makeUUID(crippledCreature);

  /**
   * Instantiate the discovery mechanism
   */
  const discoverStructure = new DiscoverStructure(crippledCreature);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);
  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  const candidateSquashes = await discoverStructure
    .analyzeSelectedNeuronsSquashes([
      "hidden-3",
    ]);

  assert(candidateSquashes, "Should have discovered a squash improvement");
  assert(
    candidateSquashes.length > 0,
    "Should have discovered some candidate squashes",
  );
  const betterCreature = DiscoverStructure.changeSquash(
    "ABC",
    crippledCreature,
    candidateSquashes,
  );
  assert(betterCreature, "Should have discovered a better creature");
  betterCreature.validate();
  const betterCreatureJSON = betterCreature.exportJSON();

  const adjustedSquash =
    betterCreatureJSON.neurons.find((neuron) => neuron.uuid === "hidden-3")!
      .squash;

  if (adjustedSquash !== RELU.NAME && adjustedSquash !== LeakyReLU.NAME) {
    fail(
      `Should have discovered RELU or LeakyReLU as the best squash was ${adjustedSquash}`,
    );
  }

  await discoverStructure.cleanUp();
});
