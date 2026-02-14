/**
 * Behavioural tests for Bias.ts — verifying biases converge towards
 * target values over multiple accumulate/calculate cycles, and that
 * batch size boundaries trigger proper recalculation.
 *
 * These are "what" tests: they exercise real functions with test data and
 * check outcomes, not implementation details.
 *
 * Closes #1440
 */
import { assertAlmostEquals, assertGreater, assertLess } from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  accumulateBias,
  adjustedBias,
  calculateBias,
} from "../../src/propagate/Bias.ts";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeSimpleCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 1.0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

// ---------------------------------------------------------------------------
// Bias convergence over multiple cycles
// ---------------------------------------------------------------------------

Deno.test("Bias convergence - repeated accumulation moves bias towards target", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  // Accumulate samples all pointing toward bias=5
  // targetPreActivation=5, preActivation=1 (current bias) => delta=4, targetBias=1+4=5
  for (let i = 0; i < 50; i++) {
    accumulateBias(ns, 5.0, 1.0, 1.0, config);
  }

  const result = calculateBias(neuron, config);

  // The bias should move towards 5.0 from the original 1.0
  assertGreater(result, 1.0, "Bias should increase towards target");
  assertLess(result, 5.1, "Bias should not overshoot the target");
});

Deno.test("Bias convergence - negative target moves bias downward", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  // Accumulate samples pointing toward bias=-3
  // targetPreActivation=-3, preActivation=1 => delta=-4, targetBias=1+(-4)=-3
  for (let i = 0; i < 50; i++) {
    accumulateBias(ns, -3.0, 1.0, 1.0, config);
  }

  const result = calculateBias(neuron, config);

  assertLess(result, 1.0, "Bias should decrease towards negative target");
});

// ---------------------------------------------------------------------------
// Batch boundary behaviour via adjustedBias
// ---------------------------------------------------------------------------

Deno.test("adjustedBias - returns original bias before batch boundary", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 10,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  // Accumulate fewer samples than batchSize
  for (let i = 0; i < 5; i++) {
    accumulateBias(ns, 10.0, 1.0, 1.0, config);
  }

  const result = adjustedBias(neuron, config);
  assertAlmostEquals(
    result,
    1.0,
    1e-9,
    "Should return original bias before batch boundary",
  );
});

Deno.test("adjustedBias - recalculates at batch boundary", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 10,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  // Accumulate exactly batchSize samples pointing toward bias=5
  for (let i = 0; i < 10; i++) {
    accumulateBias(ns, 5.0, 1.0, 1.0, config);
  }

  const result = adjustedBias(neuron, config);

  // At batch boundary, should recalculate and differ from original
  assertGreater(result, 1.0, "Batch boundary should trigger recalculation");
});

Deno.test("adjustedBias - disableBiasAdjustment returns original", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    disableBiasAdjustment: true,
    generations: 0,
    learningRate: 1,
    batchSize: 1,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  accumulateBias(ns, 100.0, 1.0, 1.0, config);

  const result = adjustedBias(neuron, config);
  assertAlmostEquals(
    result,
    1.0,
    1e-9,
    "Disabled adjustment should return original bias",
  );
});

Deno.test("adjustedBias - constant neuron always returns its bias", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  // The constant neuron (index 1) has a fixed bias
  const constantNeuron = creature.neurons[1];

  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 1,
  });

  const result = adjustedBias(constantNeuron, config);
  assertAlmostEquals(
    result,
    constantNeuron.bias,
    1e-9,
    "Constant neuron bias should not change",
  );
});

// ---------------------------------------------------------------------------
// High-generation blending dampens adjustment
// ---------------------------------------------------------------------------

Deno.test("Bias convergence - higher generations dampen adjustment", () => {
  const creature1 = makeSimpleCreature();
  const neuron1 = creature1.neurons[1];
  const lowGenConfig = createBackPropagationConfig({
    generations: 1,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  creature1.clearState();
  const ns1 = neuron1.creature.state.node(neuron1.index);

  for (let i = 0; i < 10; i++) {
    accumulateBias(ns1, 10.0, 1.0, 1.0, lowGenConfig);
  }
  const resultLow = calculateBias(neuron1, lowGenConfig);

  const creature2 = makeSimpleCreature();
  const neuron2 = creature2.neurons[1];
  const highGenConfig = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  creature2.clearState();
  const ns2 = neuron2.creature.state.node(neuron2.index);

  for (let i = 0; i < 10; i++) {
    accumulateBias(ns2, 10.0, 1.0, 1.0, highGenConfig);
  }
  const resultHigh = calculateBias(neuron2, highGenConfig);

  const changeLow = Math.abs(resultLow - 1.0);
  const changeHigh = Math.abs(resultHigh - 1.0);

  assertGreater(
    changeLow,
    changeHigh,
    "Higher generations should dampen the bias adjustment",
  );
});

// ---------------------------------------------------------------------------
// noChange flag prevents calculation
// ---------------------------------------------------------------------------

Deno.test("Bias convergence - noChange flag preserves original bias", () => {
  const creature = makeSimpleCreature();
  const neuron = creature.neurons[1]; // hidden-0, bias=1.0
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  creature.clearState();
  const ns = neuron.creature.state.node(neuron.index);

  // Accumulate some data
  for (let i = 0; i < 10; i++) {
    accumulateBias(ns, 10.0, 1.0, 1.0, config);
  }

  // Set noChange flag
  ns.noChange = true;

  const result = calculateBias(neuron, config);
  assertAlmostEquals(
    result,
    1.0,
    1e-9,
    "noChange flag should preserve original bias",
  );
});
