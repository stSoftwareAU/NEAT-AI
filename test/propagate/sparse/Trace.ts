import { assertFalse } from "@std/assert/false";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { train } from "../../TrainTestOnlyUtil.ts";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const directory = ".test/propagate/sparse";

Deno.test("propagate-trace", () => {
  setup();
  const creature = makeCreature();

  const td = makeTrainData(creature);

  const results = train(creature, td, {
    targetError: 0.01,
    iterations: 1,
    learningRate: 1,
    disableWeightAdjustment: true,
    disableRandomSamples: true,
    batchSize: 100,
    sparseRatio: 0.01,
  });

  const traced = Creature.fromJSON(results.trace).traceJSON();

  Deno.writeTextFileSync(
    `${directory}/trace.json`,
    JSON.stringify(results.trace, null, 1),
  );

  let allNeuronTraced = true;
  traced.neurons.forEach((neuron) => {
    if (!neuron.trace) {
      allNeuronTraced = false;
    }
  });

  assertFalse(allNeuronTraced, "All neurons should not be traced");

  let allSynapseTraced = true;
  traced.synapses.forEach((synapse) => {
    if (!synapse.trace) {
      allSynapseTraced = false;
    }
  });
  assertFalse(allSynapseTraced, "All synapses should not be traced");
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: "Cosine",
        uuid: "hidden-0",
        bias: -0.1,
      },
      {
        type: "hidden",
        squash: "ABSOLUTE",
        uuid: "hidden-1",
        bias: 0.2,
      },
      {
        type: "hidden",
        squash: "BENT_IDENTITY",
        uuid: "hidden-2",
        bias: -0.2,
      },
      {
        type: "hidden",
        squash: "BIPOLAR_SIGMOID",
        uuid: "hidden-3",
        bias: 0.3,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3a",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3b",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3c",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3d",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3e",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "ReLU6",
        uuid: "hidden-4",
        bias: -0.3,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0.1,
      },
      {
        type: "output",
        squash: "TANH",
        uuid: "output-1",
        bias: 0.1,
      },
      {
        type: "output",
        squash: "Softplus",
        uuid: "output-2",
        bias: -0.2,
      },
      {
        type: "output",
        squash: "Mish",
        uuid: "output-3",
        bias: -0.15,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },

      { fromUUID: "input-2", toUUID: "hidden-3a", weight: 0.45 },
      { fromUUID: "input-2", toUUID: "hidden-3b", weight: -0.11 },
      { fromUUID: "input-2", toUUID: "hidden-3c", weight: 0.12 },
      { fromUUID: "input-2", toUUID: "hidden-3d", weight: -0.13 },
      { fromUUID: "input-2", toUUID: "hidden-3e", weight: 0.14 },

      { fromUUID: "hidden-3a", toUUID: "hidden-4", weight: -0.45 },
      { fromUUID: "hidden-3b", toUUID: "hidden-4", weight: 0.46 },
      { fromUUID: "hidden-3c", toUUID: "hidden-4", weight: -0.47 },
      { fromUUID: "hidden-3d", toUUID: "hidden-4", weight: 0.48 },
      { fromUUID: "hidden-3e", toUUID: "hidden-4", weight: -0.49 },

      { fromUUID: "input-2", toUUID: "hidden-3", weight: -0.4 },
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: 0.4 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: -0.6 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-0", toUUID: "hidden-3", weight: 0.14 },
      { fromUUID: "hidden-1", toUUID: "hidden-3", weight: -0.11 },
      { fromUUID: "hidden-2", toUUID: "hidden-3", weight: 0.12 },
      { fromUUID: "hidden-3", toUUID: "output-1", weight: -0.16 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.13 },
      { fromUUID: "input-0", toUUID: "output-1", weight: -0.18 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.12 },
      { fromUUID: "input-2", toUUID: "output-1", weight: -0.15 },
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.21 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.22 },
      { fromUUID: "hidden-0", toUUID: "hidden-2", weight: -0.3 },

      { fromUUID: "input-0", toUUID: "hidden-2", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "output-2", weight: 0.25 },
      { fromUUID: "hidden-4", toUUID: "output-3", weight: -0.25 },
    ],
    input: 3,
    output: 4,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeTrainData(creature: Creature) {
  const tdFN = "test/propagate/sparse/.td.json";
  try {
    const input = JSON.parse(
      Deno.readTextFileSync(tdFN),
    );
    return input;
  } // deno-lint-ignore no-empty
  catch (_e) {}

  const td: DataRecordInterface[] = [];

  for (let i = 999; i--;) {
    const pos = i % 3;
    const input = [
      pos === 0 ? 1 : pos === 1 ? 0 : -1,
      pos === 0 ? 0 : pos === 1 ? -1 : 1,
      pos === 0 ? -1 : pos === 1 ? 1 : 0,
    ];
    const output = creature.activate(new Float32Array(input));

    td.push({
      input: new Float32Array(input),
      output: new Float32Array(Array.from(output)),
    });
  }

  Deno.writeTextFileSync(
    tdFN,
    JSON.stringify(td, null, 1),
  );
  return td;
}

function setup() {
  try {
    Deno.removeSync(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }

  Deno.mkdirSync(directory, { recursive: true });
}
