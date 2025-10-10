import { assert, assertAlmostEquals } from "@std/assert";
import { calculateLearningRate } from "../../src/propagate/BackPropagation.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/LearningRateVerification - should actually decay learning rate over iterations", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });

  const lr0 = calculateLearningRate(config, 0);
  const lr1 = calculateLearningRate(config, 1);
  const lr2 = calculateLearningRate(config, 2);
  const lr5 = calculateLearningRate(config, 5);

  // Learning rate should decay over iterations
  assertAlmostEquals(lr0, 0.1, 0.001, "Initial learning rate should be 0.1");
  assertAlmostEquals(
    lr1,
    0.09,
    0.001,
    "Learning rate after 1 iteration should be 0.09",
  );
  assertAlmostEquals(
    lr2,
    0.081,
    0.001,
    "Learning rate after 2 iterations should be 0.081",
  );
  assertAlmostEquals(
    lr5,
    0.059049,
    0.001,
    "Learning rate after 5 iterations should be 0.059049",
  );

  // Verify decay pattern
  assert(lr0 > lr1, "Learning rate should decrease from iteration 0 to 1");
  assert(lr1 > lr2, "Learning rate should decrease from iteration 1 to 2");
  assert(lr2 > lr5, "Learning rate should decrease from iteration 2 to 5");
});

Deno.test("optimization/LearningRateVerification - should use fixed learning rate when strategy is fixed", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "fixed",
    learningRate: 0.5,
  });

  const lr0 = calculateLearningRate(config, 0);
  const lr1 = calculateLearningRate(config, 1);
  const lr10 = calculateLearningRate(config, 10);

  // Learning rate should stay constant
  assertAlmostEquals(lr0, 0.5, 0.001, "Fixed learning rate should be 0.5");
  assertAlmostEquals(lr1, 0.5, 0.001, "Fixed learning rate should remain 0.5");
  assertAlmostEquals(lr10, 0.5, 0.001, "Fixed learning rate should remain 0.5");
});
