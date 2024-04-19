import { ensureDirSync } from "https://deno.land/std@0.223.0/fs/mod.ts";
import { Creature, CreatureExport } from "../../mod.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import {
  assert,
  assertAlmostEquals,
  fail,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { Costs } from "../../src/Costs.ts";

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

function makeData() {
  const inputs: number[][] = [];

  for (let i = 1000; i--;) {
    inputs.push([
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ]);
  }
  return inputs;
}

Deno.test("PropagateIdentity", () => {
  const creature = makeCreature();
  const traceDir = ".test/PropagateIdentity";

  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inputs = makeData();
  Deno.writeTextFileSync(
    `${traceDir}/input.json`,
    JSON.stringify(inputs, null, 2),
  );
  // const inputs = JSON.parse(
  //   Deno.readTextFileSync(`${traceDir}/input.json`),
  // ) as number[][];

  const targets: number[][] = new Array(inputs.length);
  for (let i = inputs.length; i--;) {
    targets[i] = creature.activate(inputs[i]);
  }

  const neuron = creature.neurons.find((n) => n.uuid === "absolute-5");
  if (!neuron) fail("neuron not found");

  const startError = calculateError(creature, inputs, targets);
  assertAlmostEquals(startError, 0, 0.0000001);
  neuron.bias = 0;
  Deno.writeTextFileSync(
    `${traceDir}/1-modified.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const modifiedError = calculateError(creature, inputs, targets);
  const config = new BackPropagationConfig({
    useAverageDifferenceBias: "Yes",
    generations: 0,
    learningRate: 1,
    disableRandomSamples: true,
    // disableWeightAdjustment: true,
    // disableBiasAdjustment: false,
  });

  for (let i = inputs.length; i--;) {
    creature.activateAndTrace(inputs[i]);
    creature.propagate(targets[i], config);
  }

  const traced = creature.traceJSON();
  Deno.writeTextFileSync(
    `${traceDir}/2-trace.json`,
    JSON.stringify(traced, null, 2),
  );

  creature.propagateUpdate(config);
  Deno.writeTextFileSync(
    `${traceDir}/3-end.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const endError = calculateError(creature, inputs, targets);
  console.info(
    `error ${endError} should have improved over ${modifiedError}`,
    config,
  );

  // assert(
  //   modifiedError > endError,
  //   `error ${endError} should have improved over ${modifiedError}`,
  // );

  if (neuron.bias < 0.00001 || neuron.bias > 1) {
    console.info(`neuron.bias ${neuron.bias} not in range`);
  }
});

Deno.test("PropagateIdentityNoRealChange", () => {
  const creature = makeCreature();
  const traceDir = ".test/PropagateIdentityNoRealChange";

  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inputs = makeData();
  Deno.writeTextFileSync(
    `${traceDir}/input.json`,
    JSON.stringify(inputs, null, 2),
  );
  //   const inputs = JSON.parse(
  //     Deno.readTextFileSync(`${traceDir}/input.json`),
  //   ) as number[][];
  const targets: number[][] = new Array(inputs.length);
  for (let i = inputs.length; i--;) {
    targets[i] = creature.activate(inputs[i]);
  }

  creature.neurons.forEach((n, indx) => {
    n.bias += indx % 2 ? 1e-10 : -1e-10;
  });
  creature.synapses.forEach((s, indx) => {
    s.weight += indx % 2 ? 1e-10 : -1e-10;
  });

  Deno.writeTextFileSync(
    `${traceDir}/1-modified.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const startError = calculateError(creature, inputs, targets);
  assertAlmostEquals(startError, 0, 0.0000001);

  const modifiedError = calculateError(creature, inputs, targets);
  const config = new BackPropagationConfig({
    useAverageDifferenceBias: "Yes",
    generations: 0,
    learningRate: 1,
    disableRandomSamples: true,
    // disableBiasAdjustment: false,
    // disableWeightAdjustment: false,
  });

  console.info(config);
  for (let i = inputs.length; i--;) {
    creature.activateAndTrace(inputs[i]);
    creature.propagate(targets[i], config);
  }

  const traced = creature.traceJSON();
  Deno.writeTextFileSync(
    `${traceDir}/2-trace.json`,
    JSON.stringify(traced, null, 2),
  );

  creature.propagateUpdate(config);
  Deno.writeTextFileSync(
    `${traceDir}/3-end.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const endError = calculateError(creature, inputs, targets);

  assertAlmostEquals(
    modifiedError,
    endError,
    1e-12,
    `error ${endError} should have changed ${modifiedError}`,
  );
});

function calculateError(
  creature: Creature,
  inputs: number[][],
  targets: number[][],
) {
  let error = 0;
  const count = inputs.length;
  assert(count == targets.length);
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const input = inputs[i];
    const target = targets[i];
    const output = creature.activate(input, false);
    error += mse.calculate(target, output);
  }

  return error / count;
}
