import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { train } from "../TrainTestOnlyUtil.ts";

Deno.test("optimization/MiniBatch - should accumulate gradients across batch", () => {
  // Create a simple creature for testing
  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "output", squash: "IDENTITY", index: 2, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5, type: "positive" },
      { from: 1, to: 2, weight: 0.5, type: "positive" },
    ],
    input: 2,
    output: 1,
  });

  // Create training data
  const trainingData = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([2]) },
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  ];

  // Test with batch size 1 (immediate updates)
  const optionsBatch1: TrainOptions = {
    iterations: 1,
    batchSize: 1,
    learningRate: 0.1,
    targetError: 0.001,
  };

  const resultBatch1 = train(creature, trainingData, optionsBatch1);

  // Test with batch size 4 (all samples in one batch)
  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "output", squash: "IDENTITY", index: 2, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5, type: "positive" },
      { from: 1, to: 2, weight: 0.5, type: "positive" },
    ],
    input: 2,
    output: 1,
  });

  const optionsBatch4: TrainOptions = {
    iterations: 1,
    batchSize: 4,
    learningRate: 0.1,
    targetError: 0.001,
  };

  const resultBatch4 = train(creature2, trainingData, optionsBatch4);

  // Both should converge to similar results
  assertAlmostEquals(
    resultBatch1.error,
    resultBatch4.error,
    0.1,
    "Batch size 1 and 4 should produce similar results",
  );
});

Deno.test("optimization/MiniBatch - should handle partial batches", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0 },
      { type: "output", squash: "IDENTITY", index: 1, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 1, weight: 0.5, type: "positive" },
    ],
    input: 1,
    output: 1,
  });

  // Create 5 samples but batch size 3 - should handle partial batch
  const trainingData = [
    { input: new Float32Array([1]), output: new Float32Array([1]) },
    { input: new Float32Array([2]), output: new Float32Array([2]) },
    { input: new Float32Array([3]), output: new Float32Array([3]) },
    { input: new Float32Array([4]), output: new Float32Array([4]) },
    { input: new Float32Array([5]), output: new Float32Array([5]) },
  ];

  const options: TrainOptions = {
    iterations: 1,
    batchSize: 3,
    learningRate: 0.1,
    targetError: 0.001,
  };

  const result = train(creature, trainingData, options);

  // Should complete without errors
  assert(result.error >= 0, "Training should complete without errors");
});
