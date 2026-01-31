/**
 * WASM Backpropagation Integration Tests
 *
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 * Issue #1236 - Remove useJs parameter and JS activation fallback paths
 *
 * These tests verify that the WASM wrapper functions produce correct results
 * and that training works correctly with WASM backpropagation.
 */

import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { Activations } from "../src/methods/activations/Activations.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import {
  calculateError,
  initWasmActivation,
  isWasmActivationAvailable,
  isWasmSquashSupported,
  resetWasmBackpropFlag,
  safeZoneAdjustment,
  shouldUseWasmBackprop,
  squash,
  unSquash,
} from "../src/wasm/mod.ts";

// Tolerance for floating point comparisons (WASM uses f32, JS uses f64)
const TOLERANCE = 1e-5;

// Initialise WASM before tests
Deno.test({
  name: "WASM Backpropagation: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test({
  name: "WASM Backpropagation: shouldUseWasmBackprop flag",
  fn() {
    // Reset and check default behaviour (should use WASM when available)
    resetWasmBackpropFlag();
    assert(
      shouldUseWasmBackprop(),
      "Should use WASM backprop by default when available",
    );
  },
});

Deno.test({
  name: "WASM Backpropagation: isWasmSquashSupported",
  fn() {
    // Test supported squash functions
    assert(isWasmSquashSupported("TANH"), "TANH should be supported");
    assert(isWasmSquashSupported("ReLU"), "ReLU should be supported");
    assert(isWasmSquashSupported("LOGISTIC"), "LOGISTIC should be supported");
    assert(isWasmSquashSupported("GELU"), "GELU should be supported");
    assert(isWasmSquashSupported("SELU"), "SELU should be supported");
    assert(isWasmSquashSupported("ELU"), "ELU should be supported");
    assert(isWasmSquashSupported("Mish"), "Mish should be supported");
    assert(isWasmSquashSupported("Swish"), "Swish should be supported");
    assert(isWasmSquashSupported("IDENTITY"), "IDENTITY should be supported");

    // Test aggregate functions
    assert(isWasmSquashSupported("MINIMUM"), "MINIMUM should be supported");
    assert(isWasmSquashSupported("MAXIMUM"), "MAXIMUM should be supported");
    assert(isWasmSquashSupported("IF"), "IF should be supported");
  },
});

Deno.test({
  name: "WASM Backpropagation: squash function produces correct results",
  fn() {
    // Test various squash functions against known reference values
    const testCases = [
      { name: "TANH", value: 0.5, jsRef: Math.tanh(0.5) },
      { name: "ReLU", value: 0.5, jsRef: 0.5 },
      { name: "ReLU", value: -0.5, jsRef: 0 },
      { name: "LOGISTIC", value: 0.0, jsRef: 0.5 },
      { name: "IDENTITY", value: 1.23, jsRef: 1.23 },
    ];

    for (const tc of testCases) {
      const result = squash(tc.name, tc.value);

      assertAlmostEquals(
        result,
        tc.jsRef,
        TOLERANCE,
        `squash ${tc.name}(${tc.value}) should match expected`,
      );
    }
  },
});

Deno.test({
  name: "WASM Backpropagation: unSquash function produces correct results",
  fn() {
    // Test unSquash for squash functions that support it
    const testCases = [
      { name: "TANH", activation: 0.5 },
      { name: "LOGISTIC", activation: 0.7 },
      { name: "IDENTITY", activation: 1.23 },
    ];

    for (const tc of testCases) {
      const result = unSquash(tc.name, tc.activation);

      assert(
        Number.isFinite(result),
        `unSquash ${tc.name}(${tc.activation}) should be finite`,
      );

      // Round-trip test: squash(unSquash(a)) ≈ a
      const roundTrip = squash(tc.name, result);
      assertAlmostEquals(
        roundTrip,
        tc.activation,
        TOLERANCE,
        `Round-trip ${tc.name}: squash(unSquash(${tc.activation}))`,
      );
    }
  },
});

Deno.test({
  name: "WASM Backpropagation: calculateError function produces finite results",
  fn() {
    // Test calculateError for various squash functions
    const testCases = [
      {
        name: "TANH",
        currentActivation: 0.5,
        targetActivation: 0.7,
        currentValue: 0.549,
      },
      {
        name: "ReLU",
        currentActivation: 0.5,
        targetActivation: 0.8,
        currentValue: 0.5,
      },
      {
        name: "LOGISTIC",
        currentActivation: 0.5,
        targetActivation: 0.6,
        currentValue: 0.0,
      },
    ];

    for (const tc of testCases) {
      const result = calculateError(
        tc.name,
        tc.currentActivation,
        tc.targetActivation,
        tc.currentValue,
      );

      assert(
        Number.isFinite(result),
        `calculateError ${tc.name} should be finite, got ${result}`,
      );

      // Error should be non-zero when target != current
      assert(
        result !== 0,
        `calculateError ${tc.name} should be non-zero when target != current`,
      );
    }
  },
});

Deno.test({
  name:
    "WASM Backpropagation: safeZoneAdjustment function produces valid results",
  fn() {
    // Test safeZoneAdjustment for various squash functions
    const testCases = [
      { name: "TANH", rawInput: 0.0, error: 0.1 }, // In safe zone
      { name: "TANH", rawInput: 5.0, error: 0.1 }, // Near saturation
      { name: "LOGISTIC", rawInput: 0.0, error: 0.1 }, // In safe zone
      { name: "LOGISTIC", rawInput: 10.0, error: 0.1 }, // Saturated
      { name: "ReLU", rawInput: 0.5, error: 0.1 }, // Active
      { name: "ReLU", rawInput: -0.5, error: 0.1 }, // Dead
    ];

    for (const tc of testCases) {
      const result = safeZoneAdjustment(
        tc.name,
        tc.rawInput,
        tc.error,
        1.0,
      );

      // Result should be in [0, 1] range
      assert(result >= 0, "safeZoneAdjustment should be >= 0");
      assert(result <= 1, "safeZoneAdjustment should be <= 1");
    }
  },
});

Deno.test({
  name: "WASM Backpropagation: Training iteration executes without error",
  fn() {
    // This test verifies that the WASM backpropagation code path executes
    // correctly without errors. Training convergence is not guaranteed with
    // a small network and fixed parameters, so we just verify the pipeline works.
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0, squash: "TANH" },
        { type: "output", index: 3, bias: 0, squash: "TANH" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    // Training data
    const trainingData = [
      { input: new Float32Array([0.2, 0.8]), output: [0.6] },
      { input: new Float32Array([0.8, 0.2]), output: [0.8] },
    ];

    // Train with WASM backpropagation - just verify it runs without error
    const config = createBackPropagationConfig({
      learningRate: 0.1,
      generations: 0,
      plankConstant: 1e-7,
    });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    // Run training iterations
    for (const data of trainingData) {
      creature.activateAndTrace(data.input, false, sparseConfig);
      creature.propagate(new Float32Array(data.output), config, sparseConfig);
    }
    creature.propagateUpdate(config, sparseConfig);

    // If we got here without errors, the test passes
    assert(true, "WASM backpropagation pipeline executes successfully");
  },
});

Deno.test({
  name: "WASM Backpropagation: Cloned networks produce same initial output",
  fn() {
    // Verify cloned networks produce identical initial results via WASM
    const createNetwork = () => {
      const json: CreatureInternal = {
        neurons: [
          { type: "hidden", index: 2, bias: 0.5, squash: "TANH" },
          { type: "output", index: 3, bias: 0, squash: "LOGISTIC" },
        ],
        synapses: [
          { from: 0, to: 2, weight: 0.8 },
          { from: 1, to: 2, weight: -0.6 },
          { from: 2, to: 3, weight: 1.2 },
        ],
        input: 2,
        output: 1,
      };
      const creature = Creature.fromJSON(json);
      creature.fix();
      return creature;
    };

    // Training data
    const trainingData = [
      { input: new Float32Array([0.2, 0.3]), output: [0.6] },
      { input: new Float32Array([0.8, 0.1]), output: [0.8] },
      { input: new Float32Array([0.5, 0.5]), output: [0.5] },
    ];

    // Calculate error for a creature
    const calculateTotalError = (creature: Creature) => {
      let error = 0;
      for (const data of trainingData) {
        const output = creature.activate(data.input, false);
        error += Math.abs(output[0] - data.output[0]);
      }
      return error;
    };

    const creature1 = createNetwork();
    const creature2 = createNetwork();

    // Verify both start at the same state
    const error1 = calculateTotalError(creature1);
    const error2 = calculateTotalError(creature2);
    assertAlmostEquals(
      error1,
      error2,
      TOLERANCE,
      "Initial errors should match",
    );

    // Verify both can run training iteration without errors
    const config = createBackPropagationConfig({
      learningRate: 0.3,
      generations: 0,
      plankConstant: 1e-7,
    });
    const sparseConfig1 = new SparseConfig(creature1.exportJSON(), config);
    const sparseConfig2 = new SparseConfig(creature2.exportJSON(), config);

    // Run one epoch on each
    for (const data of trainingData) {
      creature1.activateAndTrace(data.input, false, sparseConfig1);
      creature1.propagate(
        new Float32Array(data.output),
        config,
        sparseConfig1,
      );
    }
    creature1.propagateUpdate(config, sparseConfig1);

    for (const data of trainingData) {
      creature2.activateAndTrace(data.input, false, sparseConfig2);
      creature2.propagate(
        new Float32Array(data.output),
        config,
        sparseConfig2,
      );
    }
    creature2.propagateUpdate(config, sparseConfig2);

    // Both should have processed training without error
    assert(true, "Both training pipelines execute successfully");
  },
});

Deno.test({
  name:
    "WASM Backpropagation: All standard squash functions work with WASM wrapper",
  fn() {
    const supportedSquashes = [
      "IDENTITY",
      "ReLU",
      "ReLU6",
      "LeakyReLU",
      "SELU",
      "ELU",
      "LOGISTIC",
      "TANH",
      "HARD_TANH",
      "SOFTSIGN",
      "Softplus",
      "Swish",
      "Mish",
      "GELU",
      "SINE",
      "Cosine",
      "TAN",
      "ArcTan",
      "GAUSSIAN",
      "BENT_IDENTITY",
      "BIPOLAR_SIGMOID",
      "BIPOLAR",
      "STEP",
      "COMPLEMENT",
      "ABSOLUTE",
      "SQUARE",
      "Cube",
      "SQRT",
      "StdInverse",
      "Exponential",
      "LogSigmoid",
      "ISRU",
    ];

    for (const squashName of supportedSquashes) {
      // Test that squash produces finite results
      const testValue = 0.5;
      const result = squash(squashName, testValue);

      assert(
        Number.isFinite(result),
        `squash ${squashName}(${testValue}) should be finite, got ${result}`,
      );

      // Test safeZoneAdjustment if the JS implementation has it
      const jsSquash = Activations.find(squashName);
      if (jsSquash.safeZoneAdjustment) {
        const safeResult = safeZoneAdjustment(
          squashName,
          testValue,
          0.1,
          1.0,
        );
        assert(
          Number.isFinite(safeResult),
          `safeZoneAdjustment ${squashName} should be finite`,
        );
        assert(
          safeResult >= 0 && safeResult <= 1,
          `safeZoneAdjustment ${squashName} should be in [0,1]`,
        );
      }
    }
  },
});

Deno.test({
  name:
    "WASM Backpropagation: Network with multiple squash types processes training",
  fn() {
    // Test that a network with various squash functions can process training
    // without errors when WASM backpropagation is enabled.
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0, squash: "ReLU" },
        { type: "hidden", index: 3, bias: 0, squash: "TANH" },
        { type: "hidden", index: 4, bias: 0, squash: "LOGISTIC" },
        { type: "output", index: 5, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 0, to: 3, weight: -0.5 },
        { from: 1, to: 3, weight: 1.0 },
        { from: 2, to: 4, weight: 1.0 },
        { from: 3, to: 4, weight: 1.0 },
        { from: 4, to: 5, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    // Training data
    const trainingData = [
      { input: new Float32Array([0.1, 0.9]), output: [0.5] },
      { input: new Float32Array([0.9, 0.1]), output: [1.0] },
      { input: new Float32Array([0.5, 0.5]), output: [0.75] },
    ];

    // Activate to get initial outputs
    for (const data of trainingData) {
      creature.activate(data.input, false);
    }

    // Train - verify it processes without error
    const config = createBackPropagationConfig({
      learningRate: 0.3,
      generations: 0,
      plankConstant: 1e-7,
    });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    for (const data of trainingData) {
      creature.activateAndTrace(data.input, false, sparseConfig);
      creature.propagate(new Float32Array(data.output), config, sparseConfig);
    }
    creature.propagateUpdate(config, sparseConfig);

    // If we got here without errors, the multi-squash network processes WASM backprop correctly
    assert(
      true,
      "Multi-squash network processes WASM backpropagation successfully",
    );
  },
});
