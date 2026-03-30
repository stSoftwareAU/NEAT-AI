/**
 * Tests for near-zero weight error propagation stability.
 *
 * Issue #1873 - When a synapse weight is near zero and the upstream neuron
 * uses a bounded squash function (e.g., TANH with range [-1, 1]), dividing
 * by the minimum effective weight produces a target activation far outside
 * the squash range. Previously, these out-of-range targets were silently
 * dropped, creating dead gradient paths. Now they are clamped to the range
 * boundary so a reduced gradient still propagates.
 *
 * Key topology for testing: the near-zero weight must connect FROM a hidden
 * neuron with a bounded squash (TANH). When the output neuron processes this
 * connection, targetFromActivation = targetFromValue / effectiveWeight
 * produces a value outside TANH's [-1, 1] range. Without clamping, the
 * gradient is silently dropped and the hidden neuron never receives a signal.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("NearZeroWeightClamping - gradient reaches hidden neuron through near-zero outbound weight", () => {
  // Network: Input →[w=1]→ H1(TANH, bias=0) →[w=1e-10]→ Output(IDENTITY)
  //
  // When processing the output neuron, it looks at H1→Output (near-zero weight).
  // Without clamping: targetFromActivation = value / 1e-7 ≈ huge, out of TANH
  //   range [-1,1], gradient dropped, H1 never receives error signal.
  // With clamping: targetFromActivation clamped to [-1,1], H1 receives signal.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1e-10 }, // Near-zero outbound
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  // Run one propagation cycle.
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  // The hidden neuron H1 (index: creature.input = 1, since neurons[0] is h1
  // after input neurons) should have received an error signal.
  const h1Index = creature.input; // First hidden neuron index
  const h1State = creature.state.node(h1Index);
  assert(
    h1State.totalErrorAbsolute > 0,
    `H1 should receive gradient signal through near-zero outbound weight, ` +
      `got totalErrorAbsolute=${h1State.totalErrorAbsolute}`,
  );

  // Verify all values remain finite (Issue #1314 protection).
  const result = creature.activate(input);
  assert(
    Number.isFinite(result[0]),
    `Output should be finite, got ${result[0]}`,
  );
});

Deno.test("NearZeroWeightClamping - hidden bias updates through near-zero outbound weight", () => {
  // Network: Input →[w=1]→ H1(TANH, bias=0) →[w=1e-10]→ Output(IDENTITY)
  //
  // After training, H1's bias should change — proving that gradient
  // propagated through the near-zero weight and H1 was processed.
  // Use multiple short apply cycles with conservative learning rate to
  // avoid overflow when TANH unsquash (atanh) approaches the boundary.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1e-10 }, // Near-zero outbound
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.01,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  const originalBias = creature.neurons[creature.input].bias;

  // Single propagation + apply cycle to verify bias changes.
  for (let i = 0; i < 10; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // H1's bias should have changed — gradient propagated through.
  const updatedBias = creature.neurons[creature.input].bias;
  assert(
    updatedBias !== originalBias,
    `H1 bias should change when gradient is clamped through near-zero weight: ` +
      `original=${originalBias}, updated=${updatedBias}`,
  );

  // All non-input values should remain finite.
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input" && neuron.type !== "constant") {
      assert(
        Number.isFinite(neuron.bias),
        `Bias must be finite: ${neuron.bias}`,
      );
    }
  }
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Weight must be finite: ${synapse.weight}`,
    );
  }
});

Deno.test("NearZeroWeightClamping - gradient flows through deep near-zero chain", () => {
  // Network: Input →[w=1]→ H1(TANH) →[w=1e-10]→ H2(TANH) →[w=1]→ Output
  //
  // H1→H2 has near-zero weight. When processing H2:
  //   targetFromActivation for H1 = value / 1e-7 ≈ huge → out of TANH range
  // Without clamping: H1 gets no gradient.
  // With clamping: H1 gets clamped gradient through H2.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "h2", weight: 1e-10 }, // Near-zero between hidden
      { fromUUID: "h2", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  // Run one propagation cycle.
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  // H1 should receive gradient through the near-zero H1→H2 connection.
  const h1Index = creature.input; // First hidden neuron
  const h1State = creature.state.node(h1Index);
  assert(
    h1State.totalErrorAbsolute > 0,
    `H1 should receive gradient through near-zero weight chain, ` +
      `got totalErrorAbsolute=${h1State.totalErrorAbsolute}`,
  );
});

Deno.test("NearZeroWeightClamping - no gradient explosion from clamped targets", () => {
  // Ensure that clamping near-zero weight targets to the squash range
  // boundary doesn't cause gradient explosion. The clamped delta should
  // be bounded by (range.high - currentActivation) at most.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "h2", weight: 1e-10 }, // Near-zero
      { fromUUID: "h2", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  // Train through the near-zero weight chain.
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < 50; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  // All weights should remain finite and bounded.
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Weight must remain finite, got ${synapse.weight}`,
    );
    assert(
      Math.abs(synapse.weight) < 1e6,
      `Weight should not explode, got ${synapse.weight}`,
    );
  }

  const result = creature.activate(input);
  assert(
    Number.isFinite(result[0]),
    `Output must be finite after chain propagation, got ${result[0]}`,
  );
});

Deno.test("NearZeroWeightClamping - large creature finite values with near-zero paths", () => {
  // Verify that propagation through a large creature with near-zero weight
  // connections remains stable and produces finite values.
  const creatureJSON = JSON.parse(
    Deno.readTextFileSync("test/propagate/large/creature.json"),
  ) as CreatureExport;

  const creature = Creature.fromJSON(creatureJSON);
  const plankConstant = 1e-7;

  // Count near-zero weight synapses.
  let nearZeroCount = 0;
  for (const synapse of creature.synapses) {
    if (Math.abs(synapse.weight) < plankConstant) {
      nearZeroCount++;
    }
  }

  // Verify the creature has synapses (sanity check).
  assert(
    creature.synapses.length > 0,
    `Large creature should have synapses`,
  );

  // Load training data.
  const tdJSON = JSON.parse(
    Deno.readTextFileSync("test/propagate/large/td.json"),
  );

  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.01,
    plankConstant: plankConstant,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  // Use first training sample.
  const sample = tdJSON[0];
  const input = new Float32Array(sample.input);
  const target = new Float32Array(sample.output);

  // Train one iteration — should not throw, all values should be finite.
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  // Verify all neuron states are finite after propagation.
  const result = creature.activate(input);
  for (let i = 0; i < result.length; i++) {
    assert(
      Number.isFinite(result[i]),
      `Output ${i} should be finite after propagation with near-zero weights, got ${
        result[i]
      }`,
    );
  }

  // Report coverage (informational — the key assertion is no crashes/NaN).
  const totalSynapses = creature.synapses.length;
  const nearZeroPercent = totalSynapses > 0
    ? ((nearZeroCount / totalSynapses) * 100).toFixed(1)
    : "0";
  assertEquals(
    typeof nearZeroPercent,
    "string",
    `Near-zero weight analysis: ${nearZeroCount}/${totalSynapses} (${nearZeroPercent}%) synapses have |weight| < ${plankConstant}`,
  );
});
