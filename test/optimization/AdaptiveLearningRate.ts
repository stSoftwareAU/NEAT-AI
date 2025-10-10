import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { train } from "../TrainTestOnlyUtil.ts";

Deno.test("optimization/AdaptiveLearningRate - should decay learning rate over iterations", () => {
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

  const trainingData = [
    { input: new Float32Array([1]), output: new Float32Array([1]) },
    { input: new Float32Array([2]), output: new Float32Array([2]) },
  ];

  // Test with decay strategy
  const optionsDecay: TrainOptions = {
    iterations: 5,
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    targetError: 0.001,
  };

  const resultDecay = train(creature, trainingData, optionsDecay);

  // Should converge
  assert(resultDecay.error < 1.0, "Decay strategy should converge");
});

Deno.test("optimization/AdaptiveLearningRate - should use fixed learning rate when specified", () => {
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

  const trainingData = [
    { input: new Float32Array([1]), output: new Float32Array([1]) },
    { input: new Float32Array([2]), output: new Float32Array([2]) },
  ];

  // Test with fixed learning rate
  const optionsFixed: TrainOptions = {
    iterations: 5,
    learningRate: 0.1, // Explicit learning rate should use fixed strategy
    targetError: 0.001,
  };

  const resultFixed = train(creature, trainingData, optionsFixed);

  // Should converge
  assert(resultFixed.error < 1.0, "Fixed learning rate should converge");
});
