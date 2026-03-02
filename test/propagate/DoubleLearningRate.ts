/**
 * Issue #1653 - Verify that the learning rate is applied exactly once per
 * weight/bias update cycle. Previously, limitWeight/limitBias was called
 * both during accumulation and during calculation, resulting in an
 * effective rate of learningRate² instead of learningRate.
 */
import { assertAlmostEquals } from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
  calculateWeight,
} from "../../src/propagate/Weight.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
  calculateBias,
} from "../../src/propagate/Bias.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";
import { Creature } from "../../src/Creature.ts";

function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

// ---------------------------------------------------------------------------
// Weight: single learning rate application
// ---------------------------------------------------------------------------

Deno.test("Issue #1653 - weight update applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const currentWeight = 1.0;
  const activation = 1.0;
  const targetValue = 2.0;
  // tmpWeight = targetValue / activation = 2.0

  const cs = new SynapseState();
  accumulateWeight(currentWeight, cs, targetValue, activation, config);

  const synapse = fakeSynapse(currentWeight);
  const result = calculateWeight(cs, synapse, config);

  // With generations=0, one sample, activation=1:
  //   averageWeight = tmpWeight = 2.0
  //   limitWeight(2.0, 1.0, config) => 1.0 + 0.5 * (2.0 - 1.0) = 1.5
  // The effective change should be learningRate * delta = 0.5 * 1.0 = 0.5
  const expectedChange = learningRate * (2.0 - currentWeight);
  assertAlmostEquals(
    result - currentWeight,
    expectedChange,
    1e-6,
    `Weight change should be ~${expectedChange} (single LR application), ` +
      `not ~${learningRate * learningRate * (2.0 - currentWeight)} (double LR)`,
  );
});

Deno.test("Issue #1653 - weight batch4 accumulates raw values (no double limiting)", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const currentWeight = 1.0;
  const activation = 1.0;
  const targetValue = 2.0;

  // Single accumulation
  const csSingle = new SynapseState();
  accumulateWeight(currentWeight, csSingle, targetValue, activation, config);

  // Batch4 accumulation
  const csBatch = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];
  accumulateWeightBatch4Way(
    [currentWeight, 0, 0, 0],
    csBatch,
    [targetValue, 0, 0, 0],
    [activation, 0, 0, 0],
    config,
  );

  // Single and batch should produce identical accumulated values
  assertAlmostEquals(
    csBatch[0].totalPositiveAdjustedValue,
    csSingle.totalPositiveAdjustedValue,
    1e-9,
    "Batch4 should match single accumulation",
  );
});

Deno.test("Issue #1653 - weight batch8 accumulates raw values (no double limiting)", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const currentWeight = 1.0;
  const activation = 1.0;
  const targetValue = 2.0;

  const csSingle = new SynapseState();
  accumulateWeight(currentWeight, csSingle, targetValue, activation, config);

  const csBatch = Array.from({ length: 8 }, () => new SynapseState());
  accumulateWeightBatch8Way(
    [currentWeight, 0, 0, 0, 0, 0, 0, 0],
    csBatch,
    [targetValue, 0, 0, 0, 0, 0, 0, 0],
    [activation, 0, 0, 0, 0, 0, 0, 0],
    config,
  );

  assertAlmostEquals(
    csBatch[0].totalPositiveAdjustedValue,
    csSingle.totalPositiveAdjustedValue,
    1e-9,
    "Batch8 should match single accumulation",
  );
});

// ---------------------------------------------------------------------------
// Bias: single learning rate application
// ---------------------------------------------------------------------------

Deno.test("Issue #1653 - bias update applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
    batchSize: 1,
  });

  // Create a minimal creature with one input and one output
  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0, squash: "IDENTITY", bias: 0 },
      {
        type: "output",
        index: 1,
        squash: "IDENTITY",
        bias: 1.0,
      },
    ],
    synapses: [{ from: 0, to: 1, weight: 1.0 }],
    input: 1,
    output: 1,
  });

  creature.clearState();
  const neuron = creature.neurons[1];
  const currentBias = neuron.bias; // 1.0

  const targetPreActivation = 3.0;
  const preActivation = 1.0;
  // biasDelta = 3.0 - 1.0 = 2.0
  // targetBias = currentBias + biasDelta = 1.0 + 2.0 = 3.0

  const ns = creature.state.node(neuron.index);
  accumulateBias(ns, targetPreActivation, preActivation, currentBias, config);

  const result = calculateBias(neuron, config);

  // With generations=0, one sample:
  //   adjustedBias = totalAdjustedBias / count = targetBias / 1 = 3.0
  //   limitBias(3.0, 1.0, config) => 1.0 + 0.5 * (3.0 - 1.0) = 2.0
  // Effective change = 0.5 * 2.0 = 1.0 (single LR application)
  const expectedChange = learningRate * (3.0 - currentBias);
  assertAlmostEquals(
    result - currentBias,
    expectedChange,
    1e-6,
    `Bias change should be ~${expectedChange} (single LR application), ` +
      `not ~${learningRate * learningRate * (3.0 - currentBias)} (double LR)`,
  );
});

Deno.test("Issue #1653 - bias batch4 accumulates raw values (no double limiting)", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
  });

  const currentBias = 1.0;
  const targetPreActivation = 3.0;
  const preActivation = 1.0;

  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 1, squash: "IDENTITY", bias: currentBias },
    ],
    synapses: [{ from: 0, to: 1, weight: 1.0 }],
    input: 1,
    output: 1,
  });
  creature.clearState();

  // Single accumulation
  const nsSingle = creature.state.node(1);
  accumulateBias(
    nsSingle,
    targetPreActivation,
    preActivation,
    currentBias,
    config,
  );

  // Batch4 accumulation (using separate creature state)
  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 1, squash: "IDENTITY", bias: currentBias },
      { type: "output", index: 2, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 3, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 4, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 1, weight: 1.0 },
      { from: 0, to: 2, weight: 1.0 },
      { from: 0, to: 3, weight: 1.0 },
      { from: 0, to: 4, weight: 1.0 },
    ],
    input: 1,
    output: 4,
  });
  creature2.clearState();

  const nsArray = [
    creature2.state.node(1),
    creature2.state.node(2),
    creature2.state.node(3),
    creature2.state.node(4),
  ];
  accumulateBiasBatch4Way(
    nsArray,
    [targetPreActivation, 0, 0, 0],
    [preActivation, 0, 0, 0],
    [currentBias, 0, 0, 0],
    config,
  );

  assertAlmostEquals(
    nsArray[0].totalAdjustedBias,
    nsSingle.totalAdjustedBias,
    1e-9,
    "Batch4 bias should match single accumulation",
  );
});

Deno.test("Issue #1653 - bias batch8 accumulates raw values (no double limiting)", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 10_000,
  });

  const currentBias = 1.0;
  const targetPreActivation = 3.0;
  const preActivation = 1.0;

  const creature = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 1, squash: "IDENTITY", bias: currentBias },
    ],
    synapses: [{ from: 0, to: 1, weight: 1.0 }],
    input: 1,
    output: 1,
  });
  creature.clearState();

  const nsSingle = creature.state.node(1);
  accumulateBias(
    nsSingle,
    targetPreActivation,
    preActivation,
    currentBias,
    config,
  );

  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "input", index: 0, squash: "IDENTITY", bias: 0 },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "output" as const,
        index: i + 1,
        squash: "IDENTITY",
        bias: i === 0 ? currentBias : 0,
      })),
    ],
    synapses: Array.from({ length: 8 }, (_, i) => ({
      from: 0,
      to: i + 1,
      weight: 1.0,
    })),
    input: 1,
    output: 8,
  });
  creature2.clearState();

  const nsArray = Array.from(
    { length: 8 },
    (_, i) => creature2.state.node(i + 1),
  );
  accumulateBiasBatch8Way(
    nsArray,
    [targetPreActivation, 0, 0, 0, 0, 0, 0, 0],
    [preActivation, 0, 0, 0, 0, 0, 0, 0],
    [currentBias, 0, 0, 0, 0, 0, 0, 0],
    config,
  );

  assertAlmostEquals(
    nsArray[0].totalAdjustedBias,
    nsSingle.totalAdjustedBias,
    1e-9,
    "Batch8 bias should match single accumulation",
  );
});
