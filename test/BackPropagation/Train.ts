import { fail } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { train } from "../../src/architecture/Training.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("Sample", () => {
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
  const startResults = train(creature, trainingSet, {
    targetError: 0.1,
    iterations: 1,
    learningRate: 1,
    disableRandomSamples: true,
    // generations: 50,
  });
  const error = startResults.error;
  Deno.writeTextFileSync(
    "test/BackPropagation/.second.json",
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  Deno.writeTextFileSync(
    "test/BackPropagation/.second-trace.json",
    JSON.stringify(startResults.trace, null, 1),
  );
  for (let i = 0; i < 10; i++) {
    const results = train(creature, trainingSet, {
      targetError: 0.1,
      iterations: 1,
      learningRate: 1,
      // generations: 50,
    });
    creature.validate();
    Creature.fromJSON(results.trace).validate();
    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error >= error) {
      Deno.writeTextFileSync(
        "test/BackPropagation/.error.json",
        JSON.stringify(creature.exportJSON(), null, 1),
      );
      Deno.writeTextFileSync(
        "test/BackPropagation/.error-trace.json",
        JSON.stringify(results.trace, null, 1),
      );
      fail(`Error rate was ${results.error}`);
    }
    console.log(results.error);
  }
});
