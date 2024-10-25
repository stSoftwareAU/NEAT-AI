import { fail } from "@std/assert";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";
import { train } from "../../Propagate/TrainTestOnlyUtil.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("large", () => {
  const directory = ".test/BackPropagation/large";
  const trainingSet = JSON.parse(
    Deno.readTextFileSync("test/BackPropagation/large/td.json"),
  );

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/BackPropagation/large/creature.json"),
    ),
  );
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
    const output = creature.activate(dataSet.input);
    const sampleError = cost.calculate(dataSet.output, output);
    errorSum += sampleError;
    counter++;
  });

  const error = errorSum / counter;
  console.log("Error", error);

  let lastError = error;
  for (let i = 0; i < 10; i++) {
    Deno.writeTextFileSync(
      `${directory}/${i}.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );
    const results = train(creature, trainingSet, {
      targetError: 0.1,
      iterations: 1,
      learningRate: 1,
      disableRandomSamples: true,
      generations: i,
    });

    console.log(i, results.error);
    creature.validate();
    Creature.fromJSON(results.trace).validate();

    Deno.writeTextFileSync(
      `${directory}/${i}-trace.json`,
      JSON.stringify(results.trace, null, 1),
    );

    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error > lastError) {
      Deno.writeTextFileSync(
        `${directory}/error.json`,
        JSON.stringify(creature.exportJSON(), null, 1),
      );
      Deno.writeTextFileSync(
        `${directory}/error-trace.json`,
        JSON.stringify(results.trace, null, 1),
      );
      if (results.error - lastError > 0.005) {
        fail(
          `Error rate was ${results.error}, regression ${
            lastError - results.error
          }`,
        );
      }
    }
    lastError = results.error;
  }
});
