/**
 * Issue #1653 - Verify learning rate is applied exactly once per
 * weight/bias update cycle, not doubled via accumulation + calculation.
 *
 * With learningRate = 0.5 and a delta of D, the adjustment should be
 * approximately 0.5 * D (not 0.25 * D from double application).
 */
import { assertAlmostEquals, assertGreater } from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  calculateWeight,
} from "../../src/propagate/Weight.ts";
import { accumulateBias, calculateBias } from "../../src/propagate/Bias.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";
import type { Neuron } from "../../src/architecture/Neuron.ts";
import type { Creature } from "../../src/Creature.ts";

function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

function fakeNeuron(bias: number, index: number): Neuron {
  const ns = new NeuronState();
  const creature = {
    state: {
      node: (_idx: number) => ns,
    },
  } as unknown as Creature;

  return {
    bias,
    index,
    type: "hidden",
    creature,
  } as unknown as Neuron;
}

// ---------------------------------------------------------------------------
// Weight: learning rate applied once
// ---------------------------------------------------------------------------

Deno.test(
  "weight update applies learning rate exactly once (not squared)",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 0.5,
      maximumWeightAdjustmentScale: 100,
      limitWeightScale: 100_000,
    });

    const currentWeight = 1.0;
    const cs = new SynapseState();
    const synapse = fakeSynapse(currentWeight);

    // Accumulate: activation=1, targetValue=3 => implied weight = 3/1 = 3
    accumulateWeight(currentWeight, cs, 3.0, 1.0, config);

    const result = calculateWeight(cs, synapse, config);

    // Target weight = 3.0, current = 1.0, delta = 2.0
    // With learningRate=0.5 applied ONCE: result = 1.0 + 0.5 * 2.0 = 2.0
    // With double application (bug): result ≈ 1.5
    assertAlmostEquals(
      result,
      2.0,
      0.01,
      "Learning rate should be applied once: expected ~2.0, not ~1.5",
    );
  },
);

Deno.test(
  "weight update with learningRate=1 passes through full delta",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 1.0,
      maximumWeightAdjustmentScale: 100,
      limitWeightScale: 100_000,
    });

    const currentWeight = 1.0;
    const cs = new SynapseState();
    const synapse = fakeSynapse(currentWeight);

    accumulateWeight(currentWeight, cs, 5.0, 1.0, config);

    const result = calculateWeight(cs, synapse, config);

    // With learningRate=1 applied once: result = 1.0 + 1.0 * (5.0 - 1.0) = 5.0
    assertAlmostEquals(
      result,
      5.0,
      0.01,
      "With learningRate=1, weight should move fully to target",
    );
  },
);

// ---------------------------------------------------------------------------
// Bias: learning rate applied once
// ---------------------------------------------------------------------------

Deno.test(
  "bias update applies learning rate exactly once (not squared)",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 0.5,
      maximumBiasAdjustmentScale: 100,
      limitBiasScale: 100_000,
    });

    const currentBias = 1.0;
    const neuron = fakeNeuron(currentBias, 0);
    const ns = neuron.creature.state.node(0);

    // targetPreActivation=4, preActivation=0 => delta=4, targetBias=1+4=5
    accumulateBias(ns, 4, 0, currentBias, config);

    const result = calculateBias(neuron, config);

    // Target bias = 5.0, current = 1.0, delta = 4.0
    // With learningRate=0.5 applied ONCE: result = 1.0 + 0.5 * (5.0 - 1.0) = 3.0
    // With double application (bug): result ≈ 1.75
    assertAlmostEquals(
      result,
      3.0,
      0.01,
      "Learning rate should be applied once: expected ~3.0, not ~1.75",
    );
  },
);

Deno.test(
  "bias update with learningRate=1 passes through full delta",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 1.0,
      maximumBiasAdjustmentScale: 100,
      limitBiasScale: 100_000,
    });

    const currentBias = 1.0;
    const neuron = fakeNeuron(currentBias, 0);
    const ns = neuron.creature.state.node(0);

    // targetPreActivation=4, preActivation=0 => delta=4, targetBias=1+4=5
    accumulateBias(ns, 4, 0, currentBias, config);

    const result = calculateBias(neuron, config);

    // With learningRate=1 applied once: result = 1.0 + 1.0 * (5.0 - 1.0) = 5.0
    assertAlmostEquals(
      result,
      5.0,
      0.01,
      "With learningRate=1, bias should move fully to target",
    );
  },
);

// ---------------------------------------------------------------------------
// Effective rate verification
// ---------------------------------------------------------------------------

Deno.test(
  "effective weight change matches configured learning rate",
  () => {
    const learningRate = 0.3;
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate,
      maximumWeightAdjustmentScale: 100,
      limitWeightScale: 100_000,
    });

    const currentWeight = 2.0;
    const cs = new SynapseState();
    const synapse = fakeSynapse(currentWeight);

    // Implied target weight = 6.0 / 1.0 = 6.0, delta = 4.0
    accumulateWeight(currentWeight, cs, 6.0, 1.0, config);
    const result = calculateWeight(cs, synapse, config);

    const actualDelta = result - currentWeight;
    const expectedDelta = learningRate * (6.0 - currentWeight);

    assertAlmostEquals(
      actualDelta,
      expectedDelta,
      0.01,
      `Effective delta ${actualDelta} should match learningRate * targetDelta = ${expectedDelta}`,
    );
  },
);

Deno.test(
  "effective bias change matches configured learning rate",
  () => {
    const learningRate = 0.3;
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate,
      maximumBiasAdjustmentScale: 100,
      limitBiasScale: 100_000,
    });

    const currentBias = 2.0;
    const neuron = fakeNeuron(currentBias, 0);
    const ns = neuron.creature.state.node(0);

    // targetPreActivation=6, preActivation=0 => delta=6, targetBias=2+6=8
    accumulateBias(ns, 6, 0, currentBias, config);
    const result = calculateBias(neuron, config);

    const actualDelta = result - currentBias;
    const targetBias = 8.0;
    const expectedDelta = learningRate * (targetBias - currentBias);

    assertAlmostEquals(
      actualDelta,
      expectedDelta,
      0.01,
      `Effective delta ${actualDelta} should match learningRate * targetDelta = ${expectedDelta}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Multiple accumulations: learning rate still applied once
// ---------------------------------------------------------------------------

Deno.test(
  "multiple weight accumulations still apply learning rate once",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 0.5,
      maximumWeightAdjustmentScale: 100,
      limitWeightScale: 100_000,
    });

    const currentWeight = 1.0;
    const cs = new SynapseState();
    const synapse = fakeSynapse(currentWeight);

    // All samples imply target weight = 3.0
    accumulateWeight(currentWeight, cs, 3.0, 1.0, config);
    accumulateWeight(currentWeight, cs, 6.0, 2.0, config);
    accumulateWeight(currentWeight, cs, 9.0, 3.0, config);

    const result = calculateWeight(cs, synapse, config);

    // Average implied weight = 3.0, delta from currentWeight = 2.0
    // With learningRate=0.5 applied once: result = 1.0 + 0.5*2.0 = 2.0
    assertAlmostEquals(
      result,
      2.0,
      0.05,
      "Multiple accumulations should not compound learning rate",
    );
  },
);

Deno.test(
  "weight change direction preserved with negative activations",
  () => {
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 0.5,
      maximumWeightAdjustmentScale: 100,
      limitWeightScale: 100_000,
    });

    const currentWeight = 1.0;
    const cs = new SynapseState();
    const synapse = fakeSynapse(currentWeight);

    // activation=-1, targetValue=-3 => implied weight = -3/-1 = 3
    accumulateWeight(currentWeight, cs, -3.0, -1.0, config);

    const result = calculateWeight(cs, synapse, config);

    // Target weight = 3.0, delta = 2.0
    // With learningRate=0.5 applied once: result = 1.0 + 0.5*2.0 = 2.0
    assertGreater(
      result,
      currentWeight,
      "Weight should increase toward target",
    );
    assertAlmostEquals(
      result,
      2.0,
      0.05,
      "Negative activation path should also apply learning rate once",
    );
  },
);
