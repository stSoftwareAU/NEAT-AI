/**
 * Test finite value protections for observations, weights, biases, and activations.
 *
 * Issue #1314 - All observations, weights, biases & activations must be finite.
 *
 * These tests verify that the system properly handles and prevents non-finite values
 * (Infinity, -Infinity, NaN) from propagating through the network during training.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { accumulateBias, limitBias } from "../../src/propagate/Bias.ts";
import { accumulateWeight, limitWeight } from "../../src/propagate/Weight.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

/**
 * Tests for limitBias finite value protection.
 * The limitBias function must reject non-finite target bias values.
 */
Deno.test("limitBias - rejects positive Infinity target bias", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitBias(Infinity, 0.5, config),
    Error,
    "finite",
    "limitBias should reject positive Infinity",
  );
});

Deno.test("limitBias - rejects negative Infinity target bias", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitBias(-Infinity, 0.5, config),
    Error,
    "finite",
    "limitBias should reject negative Infinity",
  );
});

Deno.test("limitBias - rejects NaN target bias", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitBias(NaN, 0.5, config),
    Error,
    "finite",
    "limitBias should reject NaN",
  );
});

/**
 * Tests for limitWeight finite value protection.
 * The limitWeight function must reject non-finite target weight values.
 */
Deno.test("limitWeight - rejects positive Infinity target weight", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitWeight(Infinity, 0.5, config),
    Error,
    "Invalid target weight",
    "limitWeight should reject positive Infinity",
  );
});

Deno.test("limitWeight - rejects negative Infinity target weight", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitWeight(-Infinity, 0.5, config),
    Error,
    "Invalid target weight",
    "limitWeight should reject negative Infinity",
  );
});

Deno.test("limitWeight - rejects NaN target weight", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  assertThrows(
    () => limitWeight(NaN, 0.5, config),
    Error,
    "Invalid target weight",
    "limitWeight should reject NaN",
  );
});

/**
 * Tests for accumulateBias finite value protection.
 * The accumulateBias function must handle non-finite pre-activation values gracefully.
 */
Deno.test("accumulateBias - handles Infinity pre-activation value gracefully", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  // This should NOT throw - it should handle the non-finite value gracefully
  // by either clamping or skipping the accumulation
  accumulateBias(
    ns,
    0.5, // targetPreActivationValue (finite)
    Infinity, // preActivationValue (non-finite)
    0.1, // currentBias
    config,
  );

  // After handling, the state should still be valid (count incremented, no NaN/Infinity in totals)
  assertEquals(
    Number.isFinite(ns.totalBias),
    true,
    "totalBias should remain finite",
  );
  assertEquals(
    Number.isFinite(ns.totalAdjustedBias),
    true,
    "totalAdjustedBias should remain finite",
  );
});

Deno.test("accumulateBias - handles -Infinity pre-activation value gracefully", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateBias(
    ns,
    0.5, // targetPreActivationValue (finite)
    -Infinity, // preActivationValue (non-finite)
    0.1, // currentBias
    config,
  );

  assertEquals(
    Number.isFinite(ns.totalBias),
    true,
    "totalBias should remain finite",
  );
  assertEquals(
    Number.isFinite(ns.totalAdjustedBias),
    true,
    "totalAdjustedBias should remain finite",
  );
});

Deno.test("accumulateBias - handles NaN pre-activation value gracefully", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateBias(
    ns,
    0.5, // targetPreActivationValue (finite)
    NaN, // preActivationValue (non-finite)
    0.1, // currentBias
    config,
  );

  assertEquals(
    Number.isFinite(ns.totalBias),
    true,
    "totalBias should remain finite",
  );
  assertEquals(
    Number.isFinite(ns.totalAdjustedBias),
    true,
    "totalAdjustedBias should remain finite",
  );
});

Deno.test("accumulateBias - handles Infinity target pre-activation value gracefully", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateBias(
    ns,
    Infinity, // targetPreActivationValue (non-finite)
    0.5, // preActivationValue (finite)
    0.1, // currentBias
    config,
  );

  assertEquals(
    Number.isFinite(ns.totalBias),
    true,
    "totalBias should remain finite",
  );
  assertEquals(
    Number.isFinite(ns.totalAdjustedBias),
    true,
    "totalAdjustedBias should remain finite",
  );
});

/**
 * Tests for accumulateWeight finite value protection.
 * The accumulateWeight function must handle non-finite activation values gracefully.
 */
Deno.test("accumulateWeight - handles Infinity activation gracefully", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const cs = creature.state.connection(0, 2);
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  // This should NOT throw - it should handle the non-finite value gracefully
  accumulateWeight(
    0.5, // currentWeight
    cs,
    1.0, // targetValue
    Infinity, // activation (non-finite)
    config,
  );

  // State should remain valid
  assertEquals(
    Number.isFinite(cs.totalPositiveActivation),
    true,
    "totalPositiveActivation should remain finite",
  );
  assertEquals(
    Number.isFinite(cs.totalPositiveAdjustedValue),
    true,
    "totalPositiveAdjustedValue should remain finite",
  );
});

Deno.test("accumulateWeight - handles -Infinity activation gracefully", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const cs = creature.state.connection(0, 2);
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateWeight(
    0.5, // currentWeight
    cs,
    1.0, // targetValue
    -Infinity, // activation (non-finite)
    config,
  );

  assertEquals(
    Number.isFinite(cs.totalNegativeActivation),
    true,
    "totalNegativeActivation should remain finite",
  );
  assertEquals(
    Number.isFinite(cs.totalNegativeAdjustedValue),
    true,
    "totalNegativeAdjustedValue should remain finite",
  );
});

Deno.test("accumulateWeight - handles NaN activation gracefully", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const cs = creature.state.connection(0, 2);
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateWeight(
    0.5, // currentWeight
    cs,
    1.0, // targetValue
    NaN, // activation (non-finite)
    config,
  );

  assertEquals(
    Number.isFinite(cs.totalPositiveActivation),
    true,
    "totalPositiveActivation should remain finite",
  );
  assertEquals(
    Number.isFinite(cs.totalNegativeActivation),
    true,
    "totalNegativeActivation should remain finite",
  );
});

Deno.test("accumulateWeight - handles Infinity target value gracefully", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const cs = creature.state.connection(0, 2);
  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });

  accumulateWeight(
    0.5, // currentWeight
    cs,
    Infinity, // targetValue (non-finite)
    1.0, // activation
    config,
  );

  assertEquals(
    Number.isFinite(cs.totalPositiveAdjustedValue),
    true,
    "totalPositiveAdjustedValue should remain finite",
  );
});

/**
 * Tests for NeuronState.traceActivation finite value protection.
 * The traceActivation method must handle non-finite activation values gracefully.
 */
Deno.test("NeuronState.traceActivation - handles Infinity gracefully", () => {
  const ns = new NeuronState();

  // This should NOT corrupt the state
  ns.traceActivation(Infinity);

  // After tracing non-finite value, the totals should remain usable
  // (either skipped, clamped, or handled appropriately)
  assertEquals(
    Number.isFinite(ns.totalActivation),
    true,
    "totalActivation should remain finite after tracing Infinity",
  );
});

Deno.test("NeuronState.traceActivation - handles -Infinity gracefully", () => {
  const ns = new NeuronState();

  ns.traceActivation(-Infinity);

  assertEquals(
    Number.isFinite(ns.totalActivation),
    true,
    "totalActivation should remain finite after tracing -Infinity",
  );
});

Deno.test("NeuronState.traceActivation - handles NaN gracefully", () => {
  const ns = new NeuronState();

  ns.traceActivation(NaN);

  assertEquals(
    Number.isFinite(ns.totalActivation),
    true,
    "totalActivation should remain finite after tracing NaN",
  );
});

/**
 * Integration test: Creature propagate with non-finite inputs.
 * Tests that the entire backpropagation pipeline handles non-finite values gracefully.
 */
Deno.test("Creature.propagate - handles extreme activation values without crashing", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  const config = createBackPropagationConfig({
    learningRate: 0.1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  // Set up initial activations
  const input = new Float32Array([0.5, 0.5]);
  creature.activateAndTrace(input, false, sparseConfig);

  // Request an extreme target activation - the system should handle this gracefully
  // without propagating Infinity through the network
  creature.propagate(
    new Float32Array([1e38]), // Very large but still finite value
    config,
    sparseConfig,
  );

  // Verify that no biases became non-finite
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      assertEquals(
        Number.isFinite(neuron.bias),
        true,
        `Neuron ${neuron.uuid} bias should remain finite, got ${neuron.bias}`,
      );
    }
  }

  // Verify that no weights became non-finite
  for (const synapse of creature.synapses) {
    assertEquals(
      Number.isFinite(synapse.weight),
      true,
      `Synapse from ${synapse.from} to ${synapse.to} weight should remain finite, got ${synapse.weight}`,
    );
  }
});

/**
 * Test that training data validation catches non-finite observations.
 */
Deno.test("Training - rejects non-finite input observations", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  // Attempting to activate with Infinity should be rejected
  assertThrows(
    () => {
      const input = new Float32Array([Infinity, 0.5]);
      creature.activate(input);
    },
    Error,
    "finite",
    "Should reject non-finite input observations",
  );
});

Deno.test("Training - rejects NaN input observations", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  assertThrows(
    () => {
      const input = new Float32Array([NaN, 0.5]);
      creature.activate(input);
    },
    Error,
    "finite",
    "Should reject NaN input observations",
  );
});
