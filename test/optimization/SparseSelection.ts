import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { train } from "../TrainTestOnlyUtil.ts";

Deno.test("optimization/SparseSelection - sparse training converges with multi-path hidden layer", () => {
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

  // Compute initial error before training
  let initialError = 0;
  for (const sample of trainingData) {
    const output = creature.activate(sample.input, false);
    initialError += (sample.output[0] - output[0]) ** 2;
  }
  initialError /= trainingData.length;

  const options: TrainOptions = {
    iterations: 5,
    sparseRatio: 0.5,
    targetError: 0.1,
  };

  const result = train(creature, trainingData, options);

  assert(Number.isFinite(result.error), "Error should be finite");
  assert(
    result.error < initialError,
    `Sparse training should reduce error: got ${result.error}, initial was ${initialError}`,
  );
});

Deno.test("optimization/SparseSelection - sparse training converges with single-path hidden layer", () => {
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

  // Compute initial error before training
  let initialError = 0;
  for (const sample of trainingData) {
    const output = creature.activate(sample.input, false);
    initialError += (sample.output[0] - output[0]) ** 2;
  }
  initialError /= trainingData.length;

  const options: TrainOptions = {
    iterations: 5,
    sparseRatio: 0.5,
    targetError: 0.1,
  };

  const result = train(creature, trainingData, options);

  assert(Number.isFinite(result.error), "Error should be finite");
  assert(
    result.error < initialError,
    `Sparse training should reduce error: got ${result.error}, initial was ${initialError}`,
  );
});
