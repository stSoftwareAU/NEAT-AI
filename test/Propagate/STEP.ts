import { fail } from "@std/assert";
import { ensureDirSync, existsSync } from "@std/fs";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { assertAlmostEquals } from "@std/assert";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "step-1", squash: "STEP", bias: 0.5 },
      { type: "hidden", uuid: "tanh-1", squash: "TANH", bias: 0 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "step-1", weight: 1 },
      { fromUUID: "input-0", toUUID: "tanh-1", weight: 1 },
      { fromUUID: "step-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "tanh-1", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
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
    ]);
  }
  return inputs;
}

Deno.test("PropagateSTEP", () => {
  const creature = makeCreature();
  const testDir = ".test/PropagateSTEP";

  ensureDirSync(testDir);

  Deno.writeTextFileSync(
    `${testDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  if (!existsSync(`${testDir}/input.json`)) {
    const generated = makeInputs();
    Deno.writeTextFileSync(
      `${testDir}/input.json`,
      JSON.stringify(generated, null, 2),
    );
  }

  const inputs = JSON.parse(
    Deno.readTextFileSync(`${testDir}/input.json`),
  ) as number[][];

  const outputs: number[][] = new Array(inputs.length);
  for (let i = inputs.length; i--;) {
    outputs[i] = creature.activate(inputs[i]);
  }

  console.info(outputs);
  const stepNeuron = creature.neurons.find((n) => n.uuid === "step-1");
  if (!stepNeuron) throw new Error("neuron not found");

  const neuron = creature.neurons.find((n) => n.uuid === "tanh-1");
  if (!neuron) throw new Error("neuron not found");

  neuron.bias = 0.5;

  const config = new BackPropagationConfig({ learningRate: 1 });
  console.info(config);
  for (let loop = 0; loop < 100; loop++) {
    for (let i = inputs.length; i--;) {
      creature.activateAndTrace(inputs[i]);
      creature.propagate(outputs[i], config);
    }
  }

  const traced = creature.traceJSON();
  Deno.writeTextFileSync(
    `${testDir}/1-trace.json`,
    JSON.stringify(traced, null, 2),
  );

  creature.propagateUpdate(config);

  Deno.writeTextFileSync(
    `${testDir}/2-end.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  assertAlmostEquals(stepNeuron.bias, 1, 0.7);

  if (neuron.bias < -0.2 || neuron.bias >= 0.55) {
    fail(`neuron.bias ${neuron.bias} not in range`);
  }
});
