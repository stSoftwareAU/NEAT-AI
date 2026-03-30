/**
 * Tests for Prediction-Error-Guided Mutation.
 *
 * Issue #1557: Use Predictive Coding prediction errors to guide NEAT
 * structural mutations — concentrating mutation probability on neurons
 * and synapses with high prediction error.
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
} from "@std/assert";
import { Creature } from "@creature";
import {
  computeMutationBias,
  selectWeightedIndex,
} from "@predictiveCoding/PredictionErrorGuidedMutation.ts";

/**
 * Helper: creates a simple 2-input, 2-hidden, 1-output creature.
 *
 * Topology:
 *   input0 (idx 0) --w=0.5--> hidden0 (idx 2) --w=0.8--> output (idx 4)
 *   input1 (idx 1) --w=0.3--> hidden0 (idx 2)
 *   input0 (idx 0) --w=0.4--> hidden1 (idx 3) --w=0.6--> output (idx 4)
 *   input1 (idx 1) --w=0.2--> hidden1 (idx 3)
 */
function createTwoHiddenCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "IDENTITY", index: 2 },
      { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 3 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 2, weight: 0.3 },
      { from: 0, to: 3, weight: 0.4 },
      { from: 1, to: 3, weight: 0.2 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.6 },
    ],
    input: 2,
    output: 1,
  });
}

/**
 * Helper: sets prediction errors on neuron states.
 */
function setPredictionErrors(
  creature: Creature,
  errors: Map<number, number>,
): void {
  for (const [index, error] of errors) {
    const state = creature.state.node(index);
    state.predictionError = error;
  }
}

Deno.test(
  "PredictionErrorGuidedMutation: computeMutationBias concentrates on high-error neurons",
  () => {
    const creature = createTwoHiddenCreature();

    // Set prediction errors: hidden0 has high error, hidden1 has low error
    setPredictionErrors(
      creature,
      new Map([
        [2, 0.9], // hidden0: high error
        [3, 0.1], // hidden1: low error
        [4, 0.5], // output: medium error
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined, "Bias should be defined when errors exist");

    // hidden0 (uuid at index 2) should have higher weight than hidden1 (index 3)
    const hidden0UUID = creature.neurons[2].id;
    const hidden1UUID = creature.neurons[3].id;

    const weight0 = bias!.neuronWeights.get(hidden0UUID)!;
    const weight1 = bias!.neuronWeights.get(hidden1UUID)!;

    assertGreater(
      weight0,
      weight1,
      "High-error neuron should have higher mutation weight",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: uniform errors produce uniform weights",
  () => {
    const creature = createTwoHiddenCreature();

    // Set uniform prediction errors on all non-input neurons
    setPredictionErrors(
      creature,
      new Map([
        [2, 0.5],
        [3, 0.5],
        [4, 0.5],
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // All non-input neurons should have equal weights
    const weights = [...bias!.neuronWeights.values()];
    const firstWeight = weights[0];
    for (const w of weights) {
      assertAlmostEquals(
        w,
        firstWeight,
        1e-10,
        "Uniform errors should give uniform weights",
      );
    }
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: bias weights are properly normalised",
  () => {
    const creature = createTwoHiddenCreature();

    setPredictionErrors(
      creature,
      new Map([
        [2, 0.9],
        [3, 0.1],
        [4, 0.5],
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // Neuron weights should sum to 1.0
    let neuronSum = 0;
    for (const w of bias!.neuronWeights.values()) {
      neuronSum += w;
    }
    assertAlmostEquals(
      neuronSum,
      1.0,
      1e-10,
      "Neuron weights should sum to 1.0",
    );

    // Synapse weights should sum to 1.0 (if any synapses exist)
    if (bias!.synapseWeights.size > 0) {
      let synapseSum = 0;
      for (const w of bias!.synapseWeights.values()) {
        synapseSum += w;
      }
      assertAlmostEquals(
        synapseSum,
        1.0,
        1e-10,
        "Synapse weights should sum to 1.0",
      );
    }
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: returns undefined when no prediction errors exist",
  () => {
    const creature = createTwoHiddenCreature();

    // No prediction errors set — PC has not been run
    const bias = computeMutationBias(creature);
    assertEquals(
      bias,
      undefined,
      "Should return undefined when no PC errors exist",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: negative prediction errors use absolute value",
  () => {
    const creature = createTwoHiddenCreature();

    // Set negative errors — the magnitude should matter, not the sign
    setPredictionErrors(
      creature,
      new Map([
        [2, -0.9], // hidden0: high absolute error
        [3, 0.1], // hidden1: low error
        [4, -0.5], // output: medium error
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    const hidden0UUID = creature.neurons[2].id;
    const hidden1UUID = creature.neurons[3].id;

    const weight0 = bias!.neuronWeights.get(hidden0UUID)!;
    const weight1 = bias!.neuronWeights.get(hidden1UUID)!;

    assertGreater(
      weight0,
      weight1,
      "Neuron with higher absolute error should have higher weight",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: synapse weights reflect connected neuron errors",
  () => {
    const creature = createTwoHiddenCreature();

    // hidden0 (idx 2) has high error, hidden1 (idx 3) has low error
    setPredictionErrors(
      creature,
      new Map([
        [2, 0.9],
        [3, 0.1],
        [4, 0.5],
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // Synapse from input0→hidden0 (0→2) connects to high-error neuron
    // Synapse from input0→hidden1 (0→3) connects to low-error neuron
    // The synapse touching the high-error neuron should have higher weight
    const synapseToHighError = bias!.synapseWeights.get("0:2");
    const synapseToLowError = bias!.synapseWeights.get("0:3");

    assert(
      synapseToHighError !== undefined,
      "Synapse 0→2 should have a weight",
    );
    assert(synapseToLowError !== undefined, "Synapse 0→3 should have a weight");
    assertGreater(
      synapseToHighError!,
      synapseToLowError!,
      "Synapse connecting to higher-error neuron should have higher weight",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: selectWeightedIndex respects weights",
  () => {
    // Run many selections with heavily skewed weights to verify distribution
    const candidates = [0, 1, 2];
    const weights = new Map<number, number>([
      [0, 0.98], // Should be selected almost always
      [1, 0.01],
      [2, 0.01],
    ]);

    const counts = new Map<number, number>([[0, 0], [1, 0], [2, 0]]);
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectWeightedIndex(candidates, weights);
      counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }

    // With 98% weight, candidate 0 should be selected at least 90% of the time
    assertGreater(
      counts.get(0)!,
      iterations * 0.9,
      "Heavily weighted candidate should be selected most often",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: selectWeightedIndex with uniform weights acts like random",
  () => {
    const candidates = [0, 1, 2, 3];
    const weights = new Map<number, number>([
      [0, 0.25],
      [1, 0.25],
      [2, 0.25],
      [3, 0.25],
    ]);

    const counts = new Map<number, number>([[0, 0], [1, 0], [2, 0], [3, 0]]);
    const iterations = 2000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectWeightedIndex(candidates, weights);
      counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }

    // Each candidate should be selected roughly 25% of the time (±15%)
    for (const [candidate, count] of counts) {
      assertGreater(
        count,
        iterations * 0.1,
        `Candidate ${candidate} should be selected at least 10% of the time`,
      );
    }
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: selectWeightedIndex falls back to uniform when no weights match",
  () => {
    const candidates = [5, 6, 7];
    // Weights for indices that don't match any candidate
    const weights = new Map<number, number>([
      [0, 0.5],
      [1, 0.5],
    ]);

    // Should still return a valid candidate (fallback to uniform)
    const selected = selectWeightedIndex(candidates, weights);
    assert(
      candidates.includes(selected),
      "Should return a valid candidate even with no matching weights",
    );
  },
);

Deno.test(
  "PredictionErrorGuidedMutation: all-zero errors produce uniform weights",
  () => {
    const creature = createTwoHiddenCreature();

    // Set all errors to zero
    setPredictionErrors(
      creature,
      new Map([
        [2, 0.0],
        [3, 0.0],
        [4, 0.0],
      ]),
    );

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // With zero errors, all neurons should have equal weight
    const weights = [...bias!.neuronWeights.values()];
    const firstWeight = weights[0];
    for (const w of weights) {
      assertAlmostEquals(
        w,
        firstWeight,
        1e-10,
        "Zero errors should give uniform weights",
      );
    }
  },
);
