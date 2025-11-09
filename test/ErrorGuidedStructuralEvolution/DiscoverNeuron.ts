import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-3",
        squash: IDENTITY.NAME,
        bias: Math.PI,
      },
      {
        type: "hidden",
        uuid: "hidden-4",
        squash: TANH.NAME,
        bias: Math.SQRT1_2,
      },

      {
        type: "hidden",
        uuid: "removed-1",
        squash: LeakyReLU.NAME,
        bias: -0.123,
      },

      {
        type: "hidden",
        uuid: "noise-1",
        squash: IDENTITY.NAME,
        bias: -0.0002,
      },

      {
        type: "hidden",
        uuid: "noise-2",
        squash: IDENTITY.NAME,
        bias: -0.0002,
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

      { fromUUID: "input-44", toUUID: "removed-1", weight: 1.2345 },
      { fromUUID: "input-51", toUUID: "noise-1", weight: 1 },
      { fromUUID: "input-52", toUUID: "noise-2", weight: -1 },

      { fromUUID: "removed-1", toUUID: "output-0", weight: -0.54321 },
      { fromUUID: "noise-1", toUUID: "output-0", weight: -0.000_0001 },
      { fromUUID: "noise-2", toUUID: "output-0", weight: 0.000_0001 },

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
        Math.random() * 4 - 2,
      );
    }
    inputs.push(observations);
  }
  return inputs;
}

Deno.test("Error-Driven Synapse Discovery neuron discovery", async () => {
  const targetCreature = makeCreature();
  const data = makeData(targetCreature.input);

  /** Record the ideal outputs from the target creature */
  const trainingData: DataRecordInterface[] = [];

  for (let i = data.length; i--;) {
    const input = data[i];
    const output = targetCreature.activate(new Float32Array(input));

    trainingData.push({
      input: new Float32Array(input),
      output: new Float32Array(output),
    });
  }

  /**
   * Create a "crippled" version by removing two important synapses
   */
  const exportedJSON = targetCreature.exportJSON();
  exportedJSON.synapses.push({
    fromUUID: "input-44",
    toUUID: "hidden-3",
    weight: 1,
  });

  const crippledCreature = Creature.fromJSON(exportedJSON);
  CreatureUtil.makeUUID(crippledCreature);

  /**
   * Instantiate the discovery mechanism
   */
  const discoverStructure = new DiscoverStructure(crippledCreature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);
  const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
  assert(recorded, "Record should succeed");
  await Promise.all([...neuronPromisesMap.values()]);

  // Flush Rust recording if using Rust
  const flushSuccess = discoverStructure.flushRustRecording();
  if (recorded && !flushSuccess) {
    throw new Error("Rust recording flush failed");
  }

  const removeHarmfulSynapse = await discoverStructure
    .analyzeSelectedNeuronsForRemoval([
      "hidden-3",
    ]);
  assert(removeHarmfulSynapse, "Should have discovered a harmful synapse");
  const betterCreature = DiscoverStructure.removeSynapse(
    "ABC",
    crippledCreature,
    removeHarmfulSynapse,
  );
  assert(betterCreature, "Should have discovered a better creature");
  betterCreature.validate();
  const betterCreatureJSON = betterCreature.exportJSON();
  /** Verify synapses that were removed are discovered again: */
  const input44ToHidden3 = betterCreatureJSON.synapses.find((synapse) =>
    synapse.fromUUID === "input-44" && synapse.toUUID === "hidden-3"
  );

  assert(
    !input44ToHidden3,
    "Should have REMOVED synapse from input-44 to hidden-3",
  );

  await discoverStructure.cleanUp();
});
