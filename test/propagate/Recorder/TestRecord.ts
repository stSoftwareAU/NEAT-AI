import { assert, assertAlmostEquals } from "@std/assert";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import type { NeuronTrace } from "../../../src/architecture/NeuronInterfaces.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { upgrade } from "../../../src/upgrade/Upgrade.ts";
import { ReplaySquash } from "./ReplaySquash.ts";
import { initWasmForTests } from "../../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("record", async () => {
  await initWasmForTests();
  const directory = ".test/propagate/Record";
  const trainingSet = JSON.parse(
    await Deno.readTextFile("test/propagate/large/td.json"),
  );

  const creature = upgrade(Creature.fromJSON(
    JSON.parse(
      await Deno.readTextFile("test/propagate/large/creature.json"),
    ),
  ));
  try {
    await Deno.remove(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    `${directory}/first.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  const cost = Costs.find("MSE");

  let errorSum = 0;
  let counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = creature.activate(new Float32Array(dataSet.input), false);
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
  });

  const errorStart = errorSum / counter;
  console.log("Error", errorStart);

  const backProductionConfig = createBackPropagationConfig({
    disableRandomSamples: true,
  });
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    backProductionConfig,
  );

  // console.log("Back Production Config", backProductionConfig);
  errorSum = 0;
  counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = creature.activateAndTrace(
      new Float32Array(dataSet.input),
      false,
      sparseConfig,
    );
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
    creature.propagate(
      new Float32Array(dataSet.output),
      backProductionConfig,
      sparseConfig,
    );
  });

  const error = errorSum / counter;
  console.log("Trace Error", error);
  const trace = creature.traceJSON();
  await Deno.writeTextFile(
    `${directory}/trace.json`,
    JSON.stringify(trace, null, 1),
  );

  assertAlmostEquals(
    error,
    errorStart,
    0.0001,
    "Error should be almost the same as before",
  );
  let worseError = 0;
  let worseNeuron: NeuronTrace | undefined;
  trace.neurons.forEach((neuron) => {
    if (!neuron.trace || !neuron.trace.totalErrorAbsolute) {
      return;
    }
    const averageError = neuron.trace.totalErrorAbsolute / neuron.trace.count;
    if (averageError > worseError) {
      worseError = averageError;
      worseNeuron = neuron;
    }
  });

  assert(worseNeuron, "Worse neuron should be found");
  console.log(`Worse neuron, Error:${worseError}`, worseNeuron);
  const squash: ActivationInterface = Activations.find(
    worseNeuron.squash!,
  ) as ActivationInterface;
  assert(squash, "Worse neuron should have a squash function");
  assert(squash.calculateError, "Must have a calculate error function");
  const record = new ReplaySquash(worseNeuron.uuid, squash);

  //"801f2ede-a53a-4b0e-901c-b31c228953cc"
  const exported = creature.exportJSON();
  for (const neuron of exported.neurons) {
    if (neuron.uuid === worseNeuron.uuid) {
      neuron.squash = record.getName();
    }
  }

  const recordedCreature = Creature.fromJSON(exported);

  errorSum = 0;
  counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = recordedCreature.activateAndTrace(
      new Float32Array(dataSet.input),
      false,
      sparseConfig,
    );
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
    recordedCreature.propagate(
      new Float32Array(dataSet.output),
      backProductionConfig,
      sparseConfig,
    );
  });

  const recordingError = errorSum / counter;
  console.log("Recorded Error", recordingError);
  assertAlmostEquals(
    recordingError,
    errorStart,
    0.0001,
    "Recorded error should be almost the same as before",
  );

  record.playback = true;

  errorSum = 0;
  counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = recordedCreature.activateAndTrace(
      new Float32Array(dataSet.input),
      false,
      sparseConfig,
    );
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
  });

  const playBackError = errorSum / counter;
  console.log("Playback Error", playBackError);
  const playbackTrace = recordedCreature.traceJSON();
  await Deno.writeTextFile(
    `${directory}/playback.json`,
    JSON.stringify(playbackTrace, null, 1),
  );
  const errorDiff = playBackError - recordingError;
  const msg =
    `Playback error: ${playBackError} should be less than starting error: ${errorStart}, difference: ${errorDiff}`;
  console.log(msg);
  // assert(
  //   errorDiff < 0,
  //   msg,
  // );
});
