// deno-lint-ignore-file no-await-in-loop -- test writes iteration/trace files sequentially
import { assert, fail } from "@std/assert";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";
import { train } from "../../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("large", async () => {
  await initWasmForTests();
  const directory = ".test/propagate/large";
  const trainingSet = JSON.parse(
    await Deno.readTextFile("test/propagate/large/td.json"),
  );

  const creature = Creature.fromJSON(
    JSON.parse(
      await Deno.readTextFile("test/propagate/large/creature.json"),
    ),
  );
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
    const output = creature.activate(new Float32Array(dataSet.input));
    const sampleError = cost.calculate(
      new Float32Array(dataSet.output),
      new Float32Array(output),
    );
    errorSum += sampleError;
    counter++;
  });

  const error = errorSum / counter;
  console.log("Error", error);

  let lastError = error;
  for (let i = 0; i < 6; i++) {
    await Deno.writeTextFile(
      `${directory}/${i}.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );
    let results;
    for (let attempts = 0; attempts < 12; attempts++) {
      const attemptResults = train(creature, trainingSet, {
        targetError: 0.1,
        iterations: 1,
        learningRate: 1,
        disableRandomSamples: true,
        generations: i,
        maximumBiasAdjustmentScale: 1,
        maximumWeightAdjustmentScale: 1,
        sparseRatio: 1,
      });
      results = attemptResults;
      if (attemptResults.error <= lastError) break;
    }
    assert(results);

    console.log(i, results.error);
    creature.validate();
    Creature.fromJSON(results.trace).validate();

    await Deno.writeTextFile(
      `${directory}/${i}-trace.json`,
      JSON.stringify(results.trace, null, 1),
    );

    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error > lastError) {
      await Deno.writeTextFile(
        `${directory}/error.json`,
        JSON.stringify(creature.exportJSON(), null, 1),
      );
      await Deno.writeTextFile(
        `${directory}/error-trace.json`,
        JSON.stringify(results.trace, null, 1),
      );
      if (results.error - lastError > 0.35) {
        fail(
          `Error rate was ${results.error}, regression ${
            lastError - results.error
          }`,
        );
      }
    }
    lastError = results.error;
    if (lastError < 0.2) {
      console.log("Stopping early, error below 0.2");
      break;
    }
  }
});
