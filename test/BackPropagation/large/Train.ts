import { fail } from "@std/assert";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import { train } from "../../../src/architecture/Training.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Sample", () => {
  const trainingSet = JSON.parse(
    Deno.readTextFileSync("test/BackPropagation/large/td.json"),
  );

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/BackPropagation/large/creature.json"),
    ),
  );
  try {
    Deno.removeSync(".test/BackPropagation", { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }
  Deno.mkdirSync(".test/BackPropagation", { recursive: true });
  Deno.writeTextFileSync(
    ".test/BackPropagation/.first.json",
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
      `.test/BackPropagation/.${i}.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );
    const results = train(creature, trainingSet, {
      targetError: 0.1,
      iterations: 1,
      learningRate: 1,
      disableRandomSamples: true,
      generations: i,
      // trainingMutationRate: 1,
      // excludeSquashList: "MINIMUM",
      excludeSquashList: "CLIPPED,IDENTITY",
    });

    console.log(i, results.error);
    creature.validate();
    Creature.fromJSON(results.trace).validate();

    Deno.writeTextFileSync(
      `.test/BackPropagation/.${i}-trace.json`,
      JSON.stringify(results.trace, null, 1),
    );

    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error > lastError) {
      Deno.writeTextFileSync(
        ".test/BackPropagation/.error.json",
        JSON.stringify(creature.exportJSON(), null, 1),
      );
      Deno.writeTextFileSync(
        ".test/BackPropagation/.error-trace.json",
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
