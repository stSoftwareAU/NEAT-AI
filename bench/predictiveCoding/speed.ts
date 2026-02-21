/**
 * Speed benchmarks for Predictive Coding inference and learning.
 *
 * Issue #1558: Measures wall-clock performance and scaling:
 * - PC inference settling speed for different network sizes
 * - Hebbian learning update speed
 * - Scaling with neuron/synapse count
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/predictiveCoding/speed.ts
 */

import { Creature } from "../../src/Creature.ts";
import { runInference } from "../../src/predictiveCoding/PredictiveCodingInference.ts";
import {
  applyHebbianUpdate,
  computeWeightGradients,
} from "../../src/predictiveCoding/PredictiveCodingLearning.ts";
import type { RequiredPredictiveCodingConfig } from "../../src/config/PredictiveCodingConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";

function makeConfig(
  overrides: Partial<RequiredPredictiveCodingConfig> = {},
): RequiredPredictiveCodingConfig {
  return { ...DEFAULT_PREDICTIVE_CODING_CONFIG, ...overrides, enabled: true };
}

// ── Small Network ────────────────────────────────────────────────────

const smallCreature = new Creature(2, 1, {
  layers: [{ count: 4 }],
});
const smallInput = new Float32Array([0.5, 0.8]);
const smallTargets = new Float64Array([0.3]);

// ── Medium Network ───────────────────────────────────────────────────

const mediumCreature = new Creature(5, 2, {
  layers: [{ count: 20 }, { count: 10 }],
});
const mediumInput = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
const mediumTargets = new Float64Array([0.7, 0.3]);

// ── Large Network ────────────────────────────────────────────────────

const largeCreature = new Creature(10, 3, {
  layers: [{ count: 50 }, { count: 30 }],
});
const largeInput = new Float32Array([
  0.1,
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  1.0,
]);
const largeTargets = new Float64Array([0.5, 0.3, 0.8]);

console.log("=== Network Sizes ===");
console.log(
  `Small: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

// ── Inference Speed ──────────────────────────────────────────────────

const inferenceConfig = makeConfig({
  inferenceSteps: 50,
  inferenceRate: 0.05,
  energyThreshold: 1e-6,
});

Deno.bench({
  name: "Small network inference (7 neurons)",
  group: "PC inference scaling",
  baseline: true,
  fn() {
    runInference(smallCreature, smallInput, inferenceConfig, smallTargets);
  },
});

Deno.bench({
  name: "Medium network inference (37 neurons)",
  group: "PC inference scaling",
  fn() {
    runInference(mediumCreature, mediumInput, inferenceConfig, mediumTargets);
  },
});

Deno.bench({
  name: "Large network inference (93 neurons)",
  group: "PC inference scaling",
  fn() {
    runInference(largeCreature, largeInput, inferenceConfig, largeTargets);
  },
});

// ── Gradient Computation Speed ───────────────────────────────────────

const gradConfig = makeConfig({
  inferenceSteps: 50,
  inferenceRate: 0.05,
  learningRate: 0.01,
  energyThreshold: 0,
});

const smallResult = runInference(
  smallCreature,
  smallInput,
  gradConfig,
  smallTargets,
);
const mediumResult = runInference(
  mediumCreature,
  mediumInput,
  gradConfig,
  mediumTargets,
);
const largeResult = runInference(
  largeCreature,
  largeInput,
  gradConfig,
  largeTargets,
);

Deno.bench({
  name: "Small network gradient computation",
  group: "PC gradient scaling",
  baseline: true,
  fn() {
    computeWeightGradients(smallCreature, smallResult, gradConfig);
  },
});

Deno.bench({
  name: "Medium network gradient computation",
  group: "PC gradient scaling",
  fn() {
    computeWeightGradients(mediumCreature, mediumResult, gradConfig);
  },
});

Deno.bench({
  name: "Large network gradient computation",
  group: "PC gradient scaling",
  fn() {
    computeWeightGradients(largeCreature, largeResult, gradConfig);
  },
});

// ── Hebbian Update Speed ─────────────────────────────────────────────

const smallGradients = computeWeightGradients(
  smallCreature,
  smallResult,
  gradConfig,
);
const mediumGradients = computeWeightGradients(
  mediumCreature,
  mediumResult,
  gradConfig,
);
const largeGradients = computeWeightGradients(
  largeCreature,
  largeResult,
  gradConfig,
);

Deno.bench({
  name: "Small network Hebbian update",
  group: "PC Hebbian update scaling",
  baseline: true,
  fn() {
    applyHebbianUpdate(smallCreature, smallGradients);
  },
});

Deno.bench({
  name: "Medium network Hebbian update",
  group: "PC Hebbian update scaling",
  fn() {
    applyHebbianUpdate(mediumCreature, mediumGradients);
  },
});

Deno.bench({
  name: "Large network Hebbian update",
  group: "PC Hebbian update scaling",
  fn() {
    applyHebbianUpdate(largeCreature, largeGradients);
  },
});
