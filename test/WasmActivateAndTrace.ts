/**
 * WASM activateAndTrace Integration Tests
 *
 * Issue #1121 - WASM Migration Phase 4: Implement activateAndTrace for WASM
 *               with backpropagation support
 *
 * These tests verify that:
 * 1. WASM activateAndTrace returns correct activation values
 * 2. WASM activateAndTrace returns correct trace/usage flags
 * 3. Trace data matches JS implementation for all activation types
 * 4. Backpropagation works correctly with WASM activation
 * 5. applyLearnings() produces identical results with WASM trace data
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../src/wasm/mod.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";

// Tolerance for floating point comparisons (WASM uses f32, JS uses f64)
const TOLERANCE = 1e-5;

/**
 * Helper function to assert two Float32Arrays are close to each other
 */
function assertArrayClose(
  actual: Float32Array,
  expected: Float32Array,
  message?: string,
  tolerance: number = TOLERANCE,
): void {
  assertEquals(
    actual.length,
    expected.length,
    `${message ?? ""}: Array lengths differ`,
  );
  for (let i = 0; i < actual.length; i++) {
    assertAlmostEquals(
      actual[i],
      expected[i],
      tolerance,
      `${message ?? ""}[${i}]`,
    );
  }
}

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM before tests
Deno.test({
  name: "WASM activateAndTrace: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test: activateAndTrace() with WASM produces same output as JS
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: Returns same activation values as JS",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "hidden", index: 3, bias: -0.2, squash: "TANH" },
        { type: "output", index: 4, bias: 0, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 0, to: 3, weight: 0.5 },
        { from: 1, to: 3, weight: 0.5 },
        { from: 2, to: 4, weight: 1.0 },
        { from: 3, to: 4, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);
    const config = createBackPropagationConfig({ generations: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    // Test with JS
    const jsOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
      false,
    );

    // Clear state and test with WASM
    creature.clearState();
    const wasmOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
      true,
    );

    assertArrayClose(
      wasmOutput,
      jsOutput,
      "WASM activateAndTrace output should match JS",
    );
  },
});

// =============================================================================
// Test: MINIMUM trace behaviour matches JS
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: MINIMUM trace behaviour matches JS",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
        { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
        { bias: 0.3, type: "hidden", squash: "MINIMUM", index: 4 },
        { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
        { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
      ],
      synapses: [
        { weight: 0.1, from: 0, to: 2 },
        { weight: -0.2, from: 1, to: 3 },
        { weight: 0.3, from: 2, to: 4 },
        { weight: -0.4, from: 3, to: 4 },
        { weight: -0.5, from: 4, to: 5 },
        { weight: 0.6, from: 4, to: 6 },
      ],
      input: 2,
      output: 2,
    };

    const input = new Float32Array([0.1, 0.2]);

    // Test JS trace and applyLearnings
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      false,
      false,
    );
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input);

    // Test WASM trace and applyLearnings
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOut = wasmCreature.activateAndTrace(
      input,
      false,
      wasmSparseConfig,
      false,
      true,
    );
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);

    // Activation values should match
    assertArrayClose(wasmOut, jsOut, "MINIMUM activation values should match");

    // applyLearnings behaviour should match
    assertEquals(
      wasmChanged,
      jsChanged,
      "MINIMUM applyLearnings changed flag should match",
    );

    // After applyLearnings, activation should still match
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "MINIMUM activation after applyLearnings should match",
    );
  },
});

// =============================================================================
// Test: MAXIMUM trace behaviour matches JS
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: MAXIMUM trace behaviour matches JS",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
        { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
        { bias: 0.3, type: "hidden", squash: "MAXIMUM", index: 4 },
        { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
        { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
      ],
      synapses: [
        { weight: 0.1, from: 0, to: 2 },
        { weight: -0.2, from: 1, to: 3 },
        { weight: 0.3, from: 2, to: 4 },
        { weight: -0.4, from: 3, to: 4 },
        { weight: -0.5, from: 4, to: 5 },
        { weight: 0.6, from: 4, to: 6 },
      ],
      input: 2,
      output: 2,
    };

    const input = new Float32Array([0.1, 0.2]);

    // Test JS trace and applyLearnings
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      false,
      false,
    );
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input);

    // Test WASM trace and applyLearnings
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOut = wasmCreature.activateAndTrace(
      input,
      false,
      wasmSparseConfig,
      false,
      true,
    );
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);

    // Activation values should match
    assertArrayClose(wasmOut, jsOut, "MAXIMUM activation values should match");

    // applyLearnings behaviour should match
    assertEquals(
      wasmChanged,
      jsChanged,
      "MAXIMUM applyLearnings changed flag should match",
    );

    // After applyLearnings, activation should still match
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "MAXIMUM activation after applyLearnings should match",
    );
  },
});

// =============================================================================
// Test: IF trace behaviour matches JS (condition > 0: positive branch used)
// =============================================================================

Deno.test({
  name:
    "WASM activateAndTrace: IF trace behaviour matches JS (positive branch)",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
        { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
        { bias: 0.3, type: "hidden", squash: "IF", index: 4 },
        { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
        { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
      ],
      synapses: [
        { weight: 0.1, from: 0, to: 2 },
        { weight: -0.2, from: 1, to: 3 },
        { weight: 0.15, from: 1, to: 4, type: "condition" },
        { weight: 0.3, from: 2, to: 4, type: "positive" },
        { weight: -0.4, from: 3, to: 4, type: "negative" },
        { weight: -0.5, from: 4, to: 5 },
        { weight: 0.6, from: 4, to: 6 },
      ],
      input: 2,
      output: 2,
    };

    // Input that makes condition > 0 (positive branch used)
    const input = new Float32Array([0.1, 0.2]);

    // Test JS trace and applyLearnings
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      false,
      false,
    );
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input);

    // Test WASM trace and applyLearnings
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOut = wasmCreature.activateAndTrace(
      input,
      false,
      wasmSparseConfig,
      false,
      true,
    );
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);

    // Activation values should match
    assertArrayClose(
      wasmOut,
      jsOut,
      "IF (positive branch) activation values should match",
    );

    // applyLearnings behaviour should match
    assertEquals(
      wasmChanged,
      jsChanged,
      "IF (positive branch) applyLearnings changed flag should match",
    );

    // After applyLearnings, activation should still match
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "IF (positive branch) activation after applyLearnings should match",
    );
  },
});

// =============================================================================
// Test: IF trace behaviour matches JS (condition <= 0: negative branch used)
// =============================================================================

Deno.test({
  name:
    "WASM activateAndTrace: IF trace behaviour matches JS (negative branch)",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
        { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
        { bias: 0.3, type: "hidden", squash: "IF", index: 4 },
        { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
        { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
      ],
      synapses: [
        { weight: 0.1, from: 0, to: 2 },
        { weight: -0.2, from: 1, to: 3 },
        { weight: -0.5, from: 1, to: 4, type: "condition" }, // Negative weight to make condition <= 0
        { weight: 0.3, from: 2, to: 4, type: "positive" },
        { weight: -0.4, from: 3, to: 4, type: "negative" },
        { weight: -0.5, from: 4, to: 5 },
        { weight: 0.6, from: 4, to: 6 },
      ],
      input: 2,
      output: 2,
    };

    // Input that makes condition <= 0 (negative branch used)
    const input = new Float32Array([0.1, 0.2]);

    // Test JS trace and applyLearnings
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      false,
      false,
    );
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input);

    // Test WASM trace and applyLearnings
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOut = wasmCreature.activateAndTrace(
      input,
      false,
      wasmSparseConfig,
      false,
      true,
    );
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);

    // Activation values should match
    assertArrayClose(
      wasmOut,
      jsOut,
      "IF (negative branch) activation values should match",
    );

    // applyLearnings behaviour should match
    assertEquals(
      wasmChanged,
      jsChanged,
      "IF (negative branch) applyLearnings changed flag should match",
    );

    // After applyLearnings, activation should still match
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "IF (negative branch) activation after applyLearnings should match",
    );
  },
});

// =============================================================================
// Test: Standard squash functions mark all synapses as used
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: Standard squash marks all synapses as used",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "TANH" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const input = new Float32Array([0.5, 0.5]);

    // Test JS trace - standard neurons should not remove any synapses
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    jsCreature.activateAndTrace(input, false, jsSparseConfig, false, false);
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );

    // Test WASM trace - should also not remove any synapses
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    wasmCreature.activateAndTrace(input, false, wasmSparseConfig, false, true);
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );

    assertEquals(
      wasmChanged,
      jsChanged,
      "Standard squash applyLearnings should match JS behaviour",
    );

    // Both should have the same number of synapses
    assertEquals(
      wasmCreature.synapses.length,
      jsCreature.synapses.length,
      "Same number of synapses after applyLearnings",
    );
  },
});

// =============================================================================
// Test: Multiple trace iterations (training loop simulation)
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: Multiple iterations produce consistent results",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 3, bias: -0.1, squash: "MAXIMUM" },
        { type: "output", index: 4, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 0, to: 3, weight: 0.8 },
        { from: 2, to: 3, weight: 0.6 },
        { from: 3, to: 4, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.5, 0.3]),
      new Float32Array([0.8, 0.1]),
    ];

    // Test with JS
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOutputs: Float32Array[] = [];
    for (const input of inputs) {
      const output = jsCreature.activateAndTrace(
        input,
        false,
        jsSparseConfig,
        false,
        false,
      );
      jsOutputs.push(new Float32Array(output));
    }

    // Test with WASM
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOutputs: Float32Array[] = [];
    for (const input of inputs) {
      const output = wasmCreature.activateAndTrace(
        input,
        false,
        wasmSparseConfig,
        false,
        true,
      );
      wasmOutputs.push(new Float32Array(output));
    }

    // All outputs should match
    for (let i = 0; i < inputs.length; i++) {
      assertArrayClose(
        wasmOutputs[i],
        jsOutputs[i],
        `Iteration ${i} output should match`,
      );
    }
  },
});

// =============================================================================
// Test: hintValue is correctly set for backpropagation
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: hintValue is correctly set for backpropagation",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "TANH" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const input = new Float32Array([0.5, 0.5]);

    // Test JS trace
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    jsCreature.activateAndTrace(input, false, jsSparseConfig, false, false);
    const jsHintValue2 = jsCreature.state.node(2).hintValue;

    // Test WASM trace
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    wasmCreature.activateAndTrace(input, false, wasmSparseConfig, false, true);
    const wasmHintValue2 = wasmCreature.state.node(2).hintValue;

    // hintValue should be the same
    assertAlmostEquals(
      wasmHintValue2,
      jsHintValue2,
      TOLERANCE,
      "hintValue should match for neuron 2",
    );
  },
});

// =============================================================================
// Test: Complex network with mixed squash functions
// =============================================================================

Deno.test({
  name:
    "WASM activateAndTrace: Complex network with mixed squash functions works correctly",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 3, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 4, bias: -0.2, squash: "TANH" },
        { type: "hidden", index: 5, bias: 0.15, squash: "MINIMUM" },
        { type: "hidden", index: 6, bias: -0.1, squash: "MAXIMUM" },
        { type: "hidden", index: 7, bias: 0.05, squash: "IF" },
        { type: "output", index: 8, bias: 0, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 3, weight: 0.5 },
        { from: 0, to: 4, weight: -0.5 },
        { from: 2, to: 4, weight: 0.8 },
        { from: 3, to: 5, weight: 0.6 },
        { from: 4, to: 5, weight: 0.4 },
        { from: 3, to: 6, weight: 0.7 },
        { from: 4, to: 6, weight: 0.3 },
        { from: 1, to: 7, weight: 0.2, type: "condition" },
        { from: 5, to: 7, weight: 0.5, type: "positive" },
        { from: 6, to: 7, weight: 0.5, type: "negative" },
        { from: 7, to: 8, weight: 1.0 },
      ],
      input: 3,
      output: 1,
    };

    const input = new Float32Array([0.3, 0.5, 0.7]);

    // Test JS trace
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      false,
      false,
    );
    jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input);
    const jsSynapseCount = jsCreature.synapses.length;

    // Test WASM trace
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();

    const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    const wasmOut = wasmCreature.activateAndTrace(
      input,
      false,
      wasmSparseConfig,
      false,
      true,
    );
    wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);
    const wasmSynapseCount = wasmCreature.synapses.length;

    // All results should match
    assertArrayClose(wasmOut, jsOut, "Complex network activation should match");
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "Complex network activation after applyLearnings should match",
    );
    assertEquals(
      wasmSynapseCount,
      jsSynapseCount,
      "Synapse count after applyLearnings should match",
    );
  },
});
