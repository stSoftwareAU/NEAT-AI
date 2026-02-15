import { assertEquals, assertNotEquals } from "@std/assert";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

Deno.test("TrainOptions - all fields are optional", () => {
  // An empty object should satisfy the TrainOptions type
  const opts: TrainOptions = {};
  assertEquals(opts.log, undefined);
  assertEquals(opts.targetError, undefined);
  assertEquals(opts.iterations, undefined);
  assertEquals(opts.traceStore, undefined);
  assertEquals(opts.trainingSampleRate, undefined);
  assertEquals(opts.trainingTimeOutMinutes, undefined);
  assertEquals(opts.feedbackLoop, undefined);
});

Deno.test("TrainOptions - accepts partial training configuration", () => {
  const opts: TrainOptions = {
    log: 1,
    targetError: 0.01,
    iterations: 100,
  };
  assertEquals(opts.log, 1);
  assertEquals(opts.targetError, 0.01);
  assertEquals(opts.iterations, 100);
});

Deno.test("TrainOptions - accepts backpropagation fields", () => {
  const opts: TrainOptions = {
    learningRate: 0.01,
    generations: 5,
    batchSize: 32,
    sparseRatio: 0.5,
    disableBiasAdjustment: true,
    disableWeightAdjustment: false,
  };
  assertEquals(opts.learningRate, 0.01);
  assertEquals(opts.generations, 5);
  assertEquals(opts.batchSize, 32);
  assertEquals(opts.sparseRatio, 0.5);
  assertEquals(opts.disableBiasAdjustment, true);
  assertEquals(opts.disableWeightAdjustment, false);
});

Deno.test("TrainOptions - accepts adjustment scale fields", () => {
  const opts: TrainOptions = {
    maximumBiasAdjustmentScale: 5,
    maximumWeightAdjustmentScale: 10,
    limitBiasScale: 5000,
    limitWeightScale: 50000,
  };
  assertEquals(opts.maximumBiasAdjustmentScale, 5);
  assertEquals(opts.maximumWeightAdjustmentScale, 10);
  assertEquals(opts.limitBiasScale, 5000);
  assertEquals(opts.limitWeightScale, 50000);
});

Deno.test("TrainOptions - accepts learning rate strategy fields", () => {
  const opts: TrainOptions = {
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.99,
    warmRestartPeriod: 20,
  };
  assertEquals(opts.learningRateStrategy, "adaptive");
  assertEquals(opts.initialLearningRate, 0.1);
  assertEquals(opts.learningRateDecay, 0.99);
  assertEquals(opts.warmRestartPeriod, 20);
});

Deno.test("TrainOptions - accepts all learning rate strategies", () => {
  const strategies: Array<TrainOptions["learningRateStrategy"]> = [
    "fixed",
    "decay",
    "adaptive",
    "warm_restart",
  ];
  for (const strategy of strategies) {
    const opts: TrainOptions = { learningRateStrategy: strategy };
    assertEquals(opts.learningRateStrategy, strategy);
  }
});

Deno.test("TrainOptions - accepts feedbackLoop field", () => {
  const optsTrue: TrainOptions = { feedbackLoop: true };
  const optsFalse: TrainOptions = { feedbackLoop: false };
  assertEquals(optsTrue.feedbackLoop, true);
  assertEquals(optsFalse.feedbackLoop, false);
});

Deno.test("TrainOptions - accepts traceStore path", () => {
  const opts: TrainOptions = { traceStore: "/tmp/trace" };
  assertEquals(opts.traceStore, "/tmp/trace");
});

Deno.test("TrainOptions - full configuration with all fields", () => {
  const opts: TrainOptions = {
    log: 1,
    targetError: 0.01,
    iterations: 50,
    traceStore: "/tmp/trace",
    trainingSampleRate: 0.8,
    trainingTimeOutMinutes: 30,
    feedbackLoop: false,
    disableRandomSamples: false,
    generations: 10,
    learningRate: 0.01,
    maximumBiasAdjustmentScale: 5,
    maximumWeightAdjustmentScale: 10,
    limitBiasScale: 5000,
    limitWeightScale: 50000,
    plankConstant: 0.001,
    trainingMutationRate: 0.1,
    disableBiasAdjustment: false,
    disableWeightAdjustment: false,
    batchSize: 64,
    sparseRatio: 0.3,
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
    warmRestartPeriod: 15,
    biasWeightCoordinationFactor: 0.2,
  };
  // Verify a subset to confirm the full object is valid
  assertNotEquals(opts, undefined);
  assertEquals(opts.targetError, 0.01);
  assertEquals(opts.biasWeightCoordinationFactor, 0.2);
});

Deno.test("TrainOptions - accepts bias-weight coordination factor", () => {
  const opts: TrainOptions = { biasWeightCoordinationFactor: 0.5 };
  assertEquals(opts.biasWeightCoordinationFactor, 0.5);
});
