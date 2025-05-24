import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { upgrade } from "../../../src/upgrade/Upgrade.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("record", () => {
  const directory = ".test/propagate/large/Record";
  const trainingSet = JSON.parse(
    Deno.readTextFileSync("test/propagate/large/td.json"),
  );

  const creature = upgrade(Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  ));
  try {
    Deno.removeSync(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }
  Deno.mkdirSync(directory, { recursive: true });
  Deno.writeTextFileSync(
    `${directory}/first.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  const cost = Costs.find("MSE");

  let errorSum = 0;
  let counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = creature.activate(new Float32Array(dataSet.input),true);
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
  });

  const errorStart = errorSum / counter;
  console.log("Error", errorStart);

  const backProductionConfig = createBackPropagationConfig({});
  const sparseConfig=new SparseConfig(creature.exportJSON(), backProductionConfig);
  errorSum = 0;
  counter = 0;
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const output = creature.activateAndTrace(new Float32Array(dataSet.input),true,sparseConfig);
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
    creature.propagate(new Float32Array(dataSet.output), backProductionConfig,sparseConfig);
  });

  const error = errorSum / counter;
  console.log("Error", error);
  const trace = creature.traceJSON();
  Deno.writeTextFileSync(
    `${directory}/trace.json`,
    JSON.stringify(trace, null, 1),
  );

  let worseError=0;
  let worseNeuron;
  trace.neurons.forEach((neuron) => {
    if( !neuron.trace || !neuron.trace.totalErrorAbsolute) {
      return;
    }
    const averageError=neuron.trace.totalErrorAbsolute / neuron.trace.count;
    if (averageError > worseError) {
      worseError = averageError;
      worseNeuron = neuron;
    }
  }
  );

  console.log(`Worse neuron, Error:${worseError}`, worseNeuron);
});
