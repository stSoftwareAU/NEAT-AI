import { assert } from "@std/assert/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { assertAlmostEquals } from "@std/assert/almost-equals";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-3",
        squash: IDENTITY.NAME,
        // squash: Cosine.NAME,
        bias: Math.PI,
        // bias: 0.01,
      },
      {
        type: "hidden",
        uuid: "hidden-4",
        // squash: IDENTITY.NAME,
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
        squash: LeakyReLU.NAME,
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

Deno.test("Error-Driven Synapse Discovery identifies missing synapses both", async () => {
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
   * Create a "crippled" version by removing two important synapses
   */
  const exportedJSON = targetCreature.exportJSON();
  exportedJSON.synapses = exportedJSON.synapses.filter((synapse) =>
    synapse.fromUUID !== "input-33" && synapse.fromUUID !== "input-22"
  );

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

  await discoverStructure.analyzeSelectedNeurons(["hidden-4"]);
  const betterCreature = await discoverStructure.analyzeSelectedNeurons([
    "hidden-3",
  ]);
  assert(betterCreature, "Should have discovered a better creature");
  betterCreature.validate();
  const betterCreatureJSON = betterCreature.exportJSON();
  /** Verify synapses that were removed are discovered again: */
  const input22 = betterCreatureJSON.synapses.find((synapse) =>
    synapse.fromUUID === "input-22"
  );

  assert(input22, "Should have added synapse from input-22");
  assertAlmostEquals(input22?.weight, 0.2, 0.075);
  const input33 = betterCreatureJSON.synapses.find((synapse) =>
    synapse.fromUUID === "input-33"
  );
  assert(input33, "Should have added synapse from input-33");
  assertAlmostEquals(input33?.weight, -0.3, 0.05);

  // New tests for listViableNeurons()
  const viableNeurons = await discoverStructure.listViableNeurons();
  assert(viableNeurons.length > 0, "There should be viable neurons listed");
  // Check descending sort order by total error
  for (let i = 1; i < viableNeurons.length; i++) {
    assert(
      viableNeurons[i - 1].totalError >= viableNeurons[i].totalError,
      "Viable neurons should be sorted by descending totalError",
    );
  }

  // New test for selectNeuronWeightedByError()
  const selectedNeuronUUID = await discoverStructure
    .selectNeuronsWeightedByError(1);
  assert(selectedNeuronUUID, "Should select a neuron UUID");
  assert(
    viableNeurons.some((neuron) => neuron.uuid === selectedNeuronUUID[0]),
    "Selected neuron UUID must be from the viable neurons list",
  );

  await discoverStructure.cleanUp();
});

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
