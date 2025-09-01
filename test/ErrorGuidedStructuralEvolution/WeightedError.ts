import { assert, assertAlmostEquals, fail } from "@std/assert";
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

      { fromUUID: "input-75", toUUID: "hidden-4", weight: -0.2 },
      { fromUUID: "input-85", toUUID: "hidden-4", weight: -1 },
      { fromUUID: "input-95", toUUID: "hidden-4", weight: 0.2 },

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
        Math.random() * 3 - 1.5,
      );
    }
    inputs.push(observations);
  }
  return inputs;
}

function initialize() {
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

  for (let i = 0; i < trainingData.length; i++) {
    const input = trainingData[i].input;

    const rand = Math.random();

    if (rand > 0.75) {
      input[75] = 0;
    }

    if (rand > 0.85) {
      input[85] = 0;
    }

    if (rand > 0.95) {
      input[95] = 0;
    }
  }

  return { targetCreature, trainingData };
}

Deno.test("Error-Driven Synapse Discovery identifies negative synapses by weighted error", async () => {
  for (let attempt = 0; true; attempt++) {
    const { targetCreature, trainingData } = initialize();
    /**
     * Create a "crippled" version by removing two important synapses
     */
    const exportedJSON = targetCreature.exportJSON();
    exportedJSON.synapses.push({
      fromUUID: "input-75",
      toUUID: "hidden-3",
      weight: -0.1,
    });
    exportedJSON.synapses.push({
      fromUUID: "input-85",
      toUUID: "hidden-3",
      weight: 1,
    });
    exportedJSON.synapses.push({
      fromUUID: "input-95",
      toUUID: "hidden-3",
      weight: 0.1,
    });
    const crippledCreature = Creature.fromJSON(exportedJSON);
    CreatureUtil.makeUUID(crippledCreature);

    /**
     * Instantiate the discovery mechanism
     */
    const discoverStructure = new DiscoverStructure(crippledCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);
    discoverStructure.record(trainingData, neuronPromisesMap);
    // deno-lint-ignore no-await-in-loop
    await Promise.all([...neuronPromisesMap.values()]);

    // deno-lint-ignore no-await-in-loop
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
    const shouldBeRemovedSynapse = betterCreatureJSON.synapses.find((synapse) =>
      synapse.fromUUID === "input-85"
    );

    if (attempt > 12 && shouldBeRemovedSynapse) {
      fail(
        "Should have REMOVED synapse from " + shouldBeRemovedSynapse?.fromUUID,
      );
    } else {
      // deno-lint-ignore no-await-in-loop
      await discoverStructure.cleanUp();
      break;
    }
  }
});

Deno.test("Error-Driven Synapse Discovery missing synapses by weighted error", async () => {
  const { targetCreature, trainingData } = initialize();

  /**
   * Create a "crippled" version by removing two important synapses
   */
  const exportedJSON = targetCreature.exportJSON();
  exportedJSON.synapses = exportedJSON.synapses.filter((synapse) => {
    if (synapse.toUUID !== "hidden-4") return true;
    return synapse.fromUUID !== "input-75" &&
      synapse.fromUUID !== "input-85" && synapse.fromUUID !== "input-95";
  });

  const crippledCreature = Creature.fromJSON(exportedJSON);
  CreatureUtil.makeUUID(crippledCreature);

  /**
   * Instantiate the discovery mechanism
   */
  const discoverStructure = new DiscoverStructure(crippledCreature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);
  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  const helpfulSynapses = await discoverStructure.analyzeSelectedNeurons([
    "hidden-4",
  ]);

  const betterCreature = DiscoverStructure.addHelpfulSynapses(
    "ABC",
    crippledCreature,
    helpfulSynapses,
  );
  assert(betterCreature, "Should have discovered a better creature");
  betterCreature.validate();
  const betterCreatureJSON = betterCreature.exportJSON();

  /** Verify synapses that were removed are discovered again: */
  const input85 = betterCreatureJSON.synapses.find((synapse) =>
    synapse.toUUID === "hidden-4" && synapse.fromUUID === "input-85"
  );

  assert(input85, "Should have added synapse from input-22");
  assertAlmostEquals(input85?.weight, -0.75, 0.1);

  await discoverStructure.cleanUp();
});
