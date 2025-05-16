import { fail } from "@std/assert";
import { ensureDirSync, existsSync } from "@std/fs";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "bipolar-3", squash: "BIPOLAR", bias: 0.1 },
      { type: "hidden", uuid: "cosine-4", squash: "Cosine", bias: -0.1 },
      { type: "hidden", uuid: "absolute-5", squash: "ABSOLUTE", bias: 0.2 },
      { type: "hidden", uuid: "mean-6", squash: "MEAN", bias: -0.2 },

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
      { fromUUID: "cosine-4", toUUID: "mean-6", weight: 0.3 },
      {
        fromUUID: "bipolar-3",
        toUUID: "mean-6",
        weight: -0.3,
      },
      {
        fromUUID: "absolute-5",
        toUUID: "mean-6",
        weight: 0.3,
      },
      { fromUUID: "mean-6", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "input-1",
        toUUID: "mean-6",
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

function makeInputs() {
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

Deno.test("PropagateMean", () => {
  const creature = makeCreature();
  const traceDir = ".test/propagateMean";

  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  if (!existsSync(`${traceDir}/input.json`)) {
    const generated = makeInputs();
    Deno.writeTextFileSync(
      `${traceDir}/input.json`,
      JSON.stringify(generated, null, 1),
    );
  }

  const inputs = JSON.parse(
    Deno.readTextFileSync(`${traceDir}/input.json`),
  ) as number[][];

  const outputs: Float32Array[] = new Array(inputs.length);
  for (let i = inputs.length; i--;) {
    outputs[i] = creature.activate(new Float32Array(inputs[i]));
  }

  const neuron = creature.neurons.find((n) => n.uuid === "absolute-5");
  if (!neuron) throw new Error("neuron not found");

  neuron.bias = 0;
  creature.state.preparedNeurons = false;

  const config = createBackPropagationConfig({ learningRate: 0.1 });
  console.info(config);
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  for (let i = inputs.length; i--;) {
    creature.activateAndTrace(new Float32Array(inputs[i]), false, sparseConfig);
    creature.propagate(new Float32Array(outputs[i]), config, sparseConfig);
  }

  const traced = creature.traceJSON();
  Deno.writeTextFileSync(
    `${traceDir}/1-trace.json`,
    JSON.stringify(traced, null, 1),
  );

  creature.propagateUpdate(config, sparseConfig);

  Deno.writeTextFileSync(
    `${traceDir}/2-end.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  if (neuron.bias < 0.00001 || neuron.bias > 1) {
    fail(`neuron.bias ${neuron.bias} not in range`);
  }
});
