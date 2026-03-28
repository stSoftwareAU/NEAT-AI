import { assert, assertAlmostEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Costs } from "../../src/Costs.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

const NODE_ID = "identity-6";
function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "bipolar-3", squash: "BIPOLAR", bias: 0.1 },
      { type: "hidden", uuid: "cosine-4", squash: "Cosine", bias: -0.1 },
      { type: "hidden", uuid: "absolute-5", squash: "ABSOLUTE", bias: 0.2 },
      { type: "hidden", uuid: NODE_ID, squash: "IDENTITY", bias: -0.2 },

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
      { fromUUID: "input-0", toUUID: "bipolar-3", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "absolute-5", weight: -1.1 },
      {
        fromUUID: "input-0",
        toUUID: "cosine-4",
        weight: -0.3,
      },
      { fromUUID: "cosine-4", toUUID: NODE_ID, weight: 0.3 },
      {
        fromUUID: "bipolar-3",
        toUUID: NODE_ID,
        weight: -0.3,
      },
      {
        fromUUID: "absolute-5",
        toUUID: NODE_ID,
        weight: 0.3,
      },
      { fromUUID: NODE_ID, toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "input-1",
        toUUID: NODE_ID,
        weight: 0.35,
      },

      { fromUUID: "cosine-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeDataSet(creature: Creature): DataRecordInterface[] {
  const dataSet: DataRecordInterface[] = [];
  for (let i = 1000; i--;) {
    const input = new Float32Array([
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ]);
    const output = creature.activate(input);
    dataSet.push({
      input,
      output: new Float32Array(Array.from(output)),
    });
  }
  return dataSet;
}

Deno.test("backprop reduces error after bias perturbation on IDENTITY network", () => {
  const creature = makeCreature();
  const dataSet = makeDataSet(creature);

  const cleanError = calculateError(creature, dataSet);
  assertAlmostEquals(cleanError, 0, 0.0000001);

  const exportJSON = creature.exportInternalJSON();

  // Perturb biases on the exported JSON, then recreate the creature
  exportJSON.neurons.forEach((neuron, indx) => {
    neuron.bias = neuron.bias +
      ((indx % 2 === 0 ? 1 : -1) * 0.1);
  });

  const modifiedCreature = Creature.fromJSON(exportJSON);
  modifiedCreature.validate();

  const modifiedError = calculateError(modifiedCreature, dataSet);
  assert(
    modifiedError > 0.0001,
    `Bias perturbation should create measurable error, got ${modifiedError}`,
  );

  const result = train(modifiedCreature, dataSet, {
    iterations: 100,
    targetError: 0,
  });

  assert(
    result.error < modifiedError,
    `Backprop should reduce error: was ${modifiedError}, now ${result.error}`,
  );
});

Deno.test("backprop produces minimal change when network nearly matches targets", () => {
  const creature = makeCreature();
  const dataSet = makeDataSet(creature);

  const cleanError = calculateError(creature, dataSet);
  assertAlmostEquals(cleanError, 0, 0.0000001);

  // Tiny perturbation — the network should remain close to optimal
  const exportJSON = creature.exportInternalJSON();
  exportJSON.neurons.forEach((neuron, indx) => {
    neuron.bias = neuron.bias + (indx % 2 ? 1e-10 : -1e-10);
  });
  exportJSON.synapses.forEach((s, indx) => {
    s.weight = s.weight + (indx % 2 ? 1e-10 : -1e-10);
  });

  const nearOptimalCreature = Creature.fromJSON(exportJSON);
  nearOptimalCreature.validate();

  const beforeError = calculateError(nearOptimalCreature, dataSet);
  assertAlmostEquals(beforeError, 0, 0.0000001);

  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    disableRandomSamples: true,
  });

  const sparseConfig = new SparseConfig(
    nearOptimalCreature.exportInternalJSON(),
    config,
  );
  for (const item of dataSet) {
    nearOptimalCreature.activateAndTrace(
      new Float32Array(item.input),
      false,
      sparseConfig,
    );
    nearOptimalCreature.propagate(
      new Float32Array(item.output),
      config,
      sparseConfig,
    );
  }

  nearOptimalCreature.propagateUpdate(config, sparseConfig);

  const afterError = calculateError(nearOptimalCreature, dataSet);

  assertAlmostEquals(
    beforeError,
    afterError,
    0.001,
    `Error should barely change: before ${beforeError}, after ${afterError}`,
  );
});

function calculateError(
  creature: Creature,
  dataSet: DataRecordInterface[],
) {
  let error = 0;
  const count = dataSet.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = dataSet[i];
    const output = creature.activate(new Float32Array(data.input), false);
    error += mse.calculate(
      new Float32Array(data.output),
      new Float32Array(output),
    );
  }

  return error / count;
}
