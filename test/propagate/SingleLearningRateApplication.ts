/**
 * Issue #1653 - Verify that learning rate is applied exactly once per
 * weight/bias update cycle, not double-applied during both accumulation
 * and calculation.
 *
 * With learningRate = 0.5, a delta should produce approximately 0.5 * delta
 * adjustment, not 0.25 * delta (which would indicate double application).
 */
import { assertAlmostEquals } from "@std/assert";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SynapseState } from "@propagate/SynapseState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
  calculateWeight,
} from "@propagate/Weight.ts";
import { NeuronState } from "@architecture/CreatureState.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
  calculateBias,
} from "@propagate/Bias.ts";
import type { Synapse } from "@architecture/Synapse.ts";
import type { Neuron } from "@architecture/Neuron.ts";
import type { CreatureState } from "@architecture/CreatureState.ts";

function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

function fakeNeuron(bias: number, index: number): Neuron {
  const ns = new NeuronState();
  const state: CreatureState = {
    node: (_idx: number) => ns,
    connection: (_from: number, _to: number) => new SynapseState(),
  } as unknown as CreatureState;
  return {
    bias,
    index,
    type: "hidden",
    creature: { state },
  } as unknown as Neuron;
}

// ---------------------------------------------------------------------------
// Weight: learning rate applied exactly once
// ---------------------------------------------------------------------------

Deno.test("Issue #1653 - weight update applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 1000,
    limitWeightScale: 100000,
    plankConstant: 1e-10,
  });

  const currentWeight = 1.0;
  const cs = new SynapseState();
  const synapse = fakeSynapse(currentWeight);

  // Target weight = targetValue / activation = 3.0 / 1.0 = 3.0
  // Delta from current = 3.0 - 1.0 = 2.0
  // With learningRate = 0.5, expected change = 0.5 * 2.0 = 1.0
  // Expected final weight = 1.0 + 1.0 = 2.0
  accumulateWeight(currentWeight, cs, 3.0, 1.0, config);
  const result = calculateWeight(cs, synapse, config);

  // If learning rate is applied once: result = 1.0 + 0.5 * (3.0 - 1.0) = 2.0
  // If learning rate is applied twice: result = 1.0 + 0.5 * ((1.0 + 0.5*(3.0-1.0)) - 1.0) = 1.5
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Learning rate should be applied exactly once, not twice",
  );
});

Deno.test("Issue #1653 - weight batch 4-way applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 1000,
    limitWeightScale: 100000,
    plankConstant: 1e-10,
  });

  const currentWeight = 1.0;
  const csArray = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  accumulateWeightBatch4Way(
    [currentWeight, currentWeight, currentWeight, currentWeight],
    csArray,
    [3.0, 3.0, 3.0, 3.0],
    [1.0, 1.0, 1.0, 1.0],
    config,
  );

  const result = calculateWeight(
    csArray[0],
    fakeSynapse(currentWeight),
    config,
  );
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Batch 4-way: learning rate should be applied exactly once",
  );
});

Deno.test("Issue #1653 - weight batch 8-way applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumWeightAdjustmentScale: 1000,
    limitWeightScale: 100000,
    plankConstant: 1e-10,
  });

  const currentWeight = 1.0;
  const csArray = Array.from({ length: 8 }, () => new SynapseState());

  accumulateWeightBatch8Way(
    Array(8).fill(currentWeight),
    csArray,
    Array(8).fill(3.0),
    Array(8).fill(1.0),
    config,
  );

  const result = calculateWeight(
    csArray[0],
    fakeSynapse(currentWeight),
    config,
  );
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Batch 8-way: learning rate should be applied exactly once",
  );
});

// ---------------------------------------------------------------------------
// Bias: learning rate applied exactly once
// ---------------------------------------------------------------------------

Deno.test("Issue #1653 - bias update applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 1000,
    limitBiasScale: 100000,
    plankConstant: 1e-10,
  });

  const currentBias = 1.0;
  const neuron = fakeNeuron(currentBias, 0);
  const ns = neuron.creature.state.node(0);

  // targetPreActivation=4, preActivation=2 => delta=2, targetBias=1+2=3
  // Delta from current = 3.0 - 1.0 = 2.0
  // With learningRate = 0.5, expected change = 0.5 * 2.0 = 1.0
  // Expected final bias = 1.0 + 1.0 = 2.0
  accumulateBias(ns, 4, 2, currentBias, config);
  const result = calculateBias(neuron, config);

  // If learning rate is applied once: result = 1.0 + 0.5 * (3.0 - 1.0) = 2.0
  // If learning rate is applied twice: result ≈ 1.0 + 0.5 * ((1.0 + 0.5*(3.0-1.0)) - 1.0) = 1.5
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Bias learning rate should be applied exactly once, not twice",
  );
});

Deno.test("Issue #1653 - bias batch 4-way applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 1000,
    limitBiasScale: 100000,
    plankConstant: 1e-10,
  });

  const currentBias = 1.0;
  const nsArray = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  accumulateBiasBatch4Way(
    nsArray,
    [4, 4, 4, 4],
    [2, 2, 2, 2],
    [currentBias, currentBias, currentBias, currentBias],
    config,
  );

  const neuron = fakeNeuron(currentBias, 0);
  // Copy state from nsArray[0] to neuron's state
  const neuronNs = neuron.creature.state.node(0);
  neuronNs.count = nsArray[0].count;
  neuronNs.totalBias = nsArray[0].totalBias;
  neuronNs.totalAdjustedBias = nsArray[0].totalAdjustedBias;

  const result = calculateBias(neuron, config);
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Batch 4-way bias: learning rate should be applied exactly once",
  );
});

Deno.test("Issue #1653 - bias batch 8-way applies learning rate exactly once", () => {
  const learningRate = 0.5;
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate,
    maximumBiasAdjustmentScale: 1000,
    limitBiasScale: 100000,
    plankConstant: 1e-10,
  });

  const currentBias = 1.0;
  const nsArray = Array.from({ length: 8 }, () => new NeuronState());

  accumulateBiasBatch8Way(
    nsArray,
    Array(8).fill(4),
    Array(8).fill(2),
    Array(8).fill(currentBias),
    config,
  );

  const neuron = fakeNeuron(currentBias, 0);
  const neuronNs = neuron.creature.state.node(0);
  neuronNs.count = nsArray[0].count;
  neuronNs.totalBias = nsArray[0].totalBias;
  neuronNs.totalAdjustedBias = nsArray[0].totalAdjustedBias;

  const result = calculateBias(neuron, config);
  assertAlmostEquals(
    result,
    2.0,
    0.01,
    "Batch 8-way bias: learning rate should be applied exactly once",
  );
});
