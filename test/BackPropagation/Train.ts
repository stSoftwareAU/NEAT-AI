import { fail } from "@std/assert";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { train } from "../../src/architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { existsSync } from "@std/fs/exists";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("Sample", () => {
  deleteHiddenFiles("test/BackPropagation");
  const trainingSet = JSON.parse(
    Deno.readTextFileSync("test/BackPropagation/td.json"),
  );

  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/BackPropagation/creature.json")),
  );

  Deno.writeTextFileSync(
    "test/BackPropagation/.first.json",
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
      `test/BackPropagation/.${i}.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );
    const results = train(creature, trainingSet, {
      targetError: 0.1,
      iterations: 1,
      learningRate: 1,
      disableRandomSamples: true,
      generations: i,
      excludeSquashList: "SINUSOID,CLIPPED,IDENTITY",
    });

    console.log(i, results.error);
    creature.validate();
    Creature.fromJSON(results.trace).validate();

    Deno.writeTextFileSync(
      `test/BackPropagation/.${i}-trace.json`,
      JSON.stringify(results.trace, null, 1),
    );

    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error > lastError) {
      Deno.writeTextFileSync(
        "test/BackPropagation/.error.json",
        JSON.stringify(creature.exportJSON(), null, 1),
      );
      Deno.writeTextFileSync(
        "test/BackPropagation/.error-trace.json",
        JSON.stringify(results.trace, null, 1),
      );
      if (results.error - lastError > 0.002) {
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

function deleteHiddenFiles(dirPath: string) {
  // Read all entries in the directory
  for (const entry of Deno.readDirSync(dirPath)) {
    // Check if the entry is a hidden file (starts with a dot)
    if (entry.isFile && entry.name.startsWith(".")) {
      const filePath = `${dirPath}/${entry.name}`;
      // Check if the file exists
      if (existsSync(filePath)) {
        // Delete the hidden file
        Deno.removeSync(filePath);
        console.log(`Deleted hidden file: ${filePath}`);
      }
    }
  }
}
