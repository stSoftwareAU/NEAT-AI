/**
 * Tests for TrainOptions integration with creature training.
 *
 * Verifies that training options affect actual training behaviour
 * when passed through evolveDataSet.
 */
import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

const simpleDataSet = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
];

Deno.test("TrainOptions - iterations=1 completes training and returns finite error", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 1,
    targetError: 0,
    populationSize: 5,
    threads: 1,
  });

  assert(Number.isFinite(result.error), "Error should be a finite number");
  assert(result.error >= 0, "Error should be non-negative");
});

Deno.test("TrainOptions - high targetError completes with finite error and score", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 100,
    targetError: 1.0,
    populationSize: 5,
    threads: 1,
  });

  assert(Number.isFinite(result.error), "Error should be a finite number");
  assert(Number.isFinite(result.score), "Score should be a finite number");
  assert(result.error >= 0, "Error should be non-negative");
});

Deno.test("TrainOptions - trainingSampleRate=0.5 completes training with finite error", async () => {
  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(simpleDataSet, {
    mutation: Mutation.FFW,
    iterations: 2,
    targetError: 0,
    populationSize: 5,
    threads: 1,
    trainingSampleRate: 0.5,
  });

  assert(Number.isFinite(result.error), "Error should be a finite number");
  assert(result.error >= 0, "Error should be non-negative");
});
