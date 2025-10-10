import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { train } from "../TrainTestOnlyUtil.ts";

Deno.test("optimization/SparseSelection - should use output-distance strategy", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "hidden", squash: "TANH", index: 2, bias: 0 },
      { type: "hidden", squash: "TANH", index: 3, bias: 0 },
      { type: "output", squash: "IDENTITY", index: 4, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5, type: "positive" },
      { from: 1, to: 3, weight: 0.5, type: "positive" },
      { from: 2, to: 4, weight: 0.5, type: "positive" },
      { from: 3, to: 4, weight: 0.5, type: "positive" },
    ],
    input: 2,
    output: 1,
  });

  const trainingData = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  ];

  // Test with output-distance strategy
  const options: TrainOptions = {
    iterations: 5,
    sparseRatio: 0.5, // Only train 50% of neurons
    sparseSelectionStrategy: "output-distance",
    targetError: 0.1,
  };

  const result = train(creature, trainingData, options);

  // Should converge
  assert(result.error < 1.0, "Output-distance strategy should converge");
});

Deno.test("optimization/SparseSelection - should fallback to random strategy", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "hidden", squash: "TANH", index: 2, bias: 0 },
      { type: "output", squash: "IDENTITY", index: 3, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5, type: "positive" },
      { from: 1, to: 2, weight: 0.5, type: "positive" },
      { from: 2, to: 3, weight: 0.5, type: "positive" },
    ],
    input: 2,
    output: 1,
  });

  const trainingData = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  ];

  // Test with random strategy (default)
  const options: TrainOptions = {
    iterations: 5,
    sparseRatio: 0.5,
    sparseSelectionStrategy: "random",
    targetError: 0.1,
  };

  const result = train(creature, trainingData, options);

  // Should converge
  assert(result.error < 1.0, "Random strategy should converge");
});
