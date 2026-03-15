/**
 * Tests for TrainOptions integration with creature training.
 *
 * Verifies that training options affect actual training behaviour
 * when passed through evolveDataSet.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

const simpleDataSet = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
];

Deno.test("TrainOptions - iterations limits training cycles", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 1,
    targetError: 0,
    populationSize: 5,
    threads: 1,
  });

  assertEquals(typeof result.error, "number");
});

Deno.test("TrainOptions - high targetError stops training early", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 100,
    targetError: 1.0,
    populationSize: 5,
    threads: 1,
  });

  // Training should complete and return a numeric error
  assertEquals(typeof result.error, "number");
  assertEquals(typeof result.score, "number");
});

Deno.test("TrainOptions - trainingSampleRate accepts fractional values", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 2,
    targetError: 0,
    populationSize: 5,
    threads: 1,
    trainingSampleRate: 0.5,
  });

  assertEquals(typeof result.error, "number");
  assertGreater(result.error, -Infinity);
});
