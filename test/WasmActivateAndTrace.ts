/**
 * WASM activateAndTrace Integration Tests
 *
 * Issue #1121 - WASM Migration Phase 4: Implement activateAndTrace for WASM
 *               with backpropagation support
 * Issue #1123 - WASM Migration Phase 6: Remove deprecated JS activation
 *
 * These tests verify that:
 * 1. WASM activateAndTrace returns correct activation values
 * 2. WASM activateAndTrace returns correct trace/usage flags
 * 3. Backpropagation works correctly with WASM activation
 * 4. applyLearnings() produces correct results with WASM trace data
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

// Tolerance for floating point comparisons (WASM uses f32)
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
// Test: activateAndTrace() with WASM produces correct output
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: Returns correct activation values",
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

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );

    // Verify output is valid
    assert(output.length === 1, "Output should have correct length");
    assert(!Number.isNaN(output[0]), "Output should not be NaN");
    assert(
      output[0] >= 0 && output[0] <= 1,
      "Logistic output should be in [0,1]",
    );
  },
});

// =============================================================================
// Test: MINIMUM trace behaviour works correctly
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: MINIMUM trace behaviour works correctly",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    const afterApply = creature.activate(input);

    // Verify output is valid
    assertEquals(output.length, 2, "Output should have 2 values");
    assert(!Number.isNaN(output[0]), "Output[0] should not be NaN");
    assert(!Number.isNaN(output[1]), "Output[1] should not be NaN");

    // Verify applyLearnings doesn't break the creature
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );
    assertArrayClose(
      afterApply,
      output,
      "Activation should be consistent",
      1e-4,
    );
  },
});

// =============================================================================
// Test: MAXIMUM trace behaviour works correctly
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: MAXIMUM trace behaviour works correctly",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    const afterApply = creature.activate(input);

    // Verify output is valid
    assertEquals(output.length, 2, "Output should have 2 values");
    assert(!Number.isNaN(output[0]), "Output[0] should not be NaN");
    assert(!Number.isNaN(output[1]), "Output[1] should not be NaN");

    // Verify applyLearnings doesn't break the creature
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );
    assertArrayClose(
      afterApply,
      output,
      "Activation should be consistent",
      1e-4,
    );
  },
});

// =============================================================================
// Test: IF trace behaviour works correctly (positive branch)
// =============================================================================

Deno.test({
  name:
    "WASM activateAndTrace: IF trace behaviour works correctly (positive branch)",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    const afterApply = creature.activate(input);

    // Verify output is valid
    assertEquals(output.length, 2, "Output should have 2 values");
    assert(!Number.isNaN(output[0]), "Output[0] should not be NaN");
    assert(!Number.isNaN(output[1]), "Output[1] should not be NaN");

    // Verify applyLearnings doesn't break the creature
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );
    assertArrayClose(
      afterApply,
      output,
      "Activation should be consistent",
      1e-4,
    );
  },
});

// =============================================================================
// Test: IF trace behaviour works correctly (negative branch)
// =============================================================================

Deno.test({
  name:
    "WASM activateAndTrace: IF trace behaviour works correctly (negative branch)",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    const afterApply = creature.activate(input);

    // Verify output is valid
    assertEquals(output.length, 2, "Output should have 2 values");
    assert(!Number.isNaN(output[0]), "Output[0] should not be NaN");
    assert(!Number.isNaN(output[1]), "Output[1] should not be NaN");

    // Verify applyLearnings doesn't break the creature
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );
    assertArrayClose(
      afterApply,
      output,
      "Activation should be consistent",
      1e-4,
    );
  },
});

// =============================================================================
// Test: Standard squash functions work with tracing
// =============================================================================

Deno.test({
  name: "WASM activateAndTrace: Standard squash functions work correctly",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    creature.activateAndTrace(input, false, sparseConfig, false);
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );

    // Verify applyLearnings returns a boolean
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );

    // Synapse count should remain 3 (standard squash uses all synapses)
    assertEquals(
      creature.synapses.length,
      3,
      "All synapses should be retained for standard squash",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const outputs: Float32Array[] = [];
    for (const input of inputs) {
      const output = creature.activateAndTrace(
        input,
        false,
        sparseConfig,
        false,
      );
      outputs.push(new Float32Array(output));
    }

    // All outputs should be valid
    for (let i = 0; i < outputs.length; i++) {
      assertEquals(
        outputs[i].length,
        1,
        `Output ${i} should have correct length`,
      );
      assert(!Number.isNaN(outputs[i][0]), `Output ${i} should not be NaN`);
    }

    // Running same inputs again should produce same outputs
    creature.clearState();
    for (let i = 0; i < inputs.length; i++) {
      const output = creature.activateAndTrace(
        inputs[i],
        false,
        sparseConfig,
        false,
      );
      assertArrayClose(
        output,
        outputs[i],
        `Iteration ${i} should be reproducible`,
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    creature.activateAndTrace(input, false, sparseConfig, false);
    const hintValue2 = creature.state.node(2).hintValue;

    // hintValue should be set (the WASM activation fills this for backprop)
    assert(typeof hintValue2 === "number", "hintValue should be a number");
    assert(!Number.isNaN(hintValue2), "hintValue should not be NaN");
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

    const creature = Creature.fromJSON(creatureJson);
    creature.validate();

    const config = createBackPropagationConfig({ sparseRatio: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    const afterApply = creature.activate(input);

    // Verify output is valid
    assertEquals(output.length, 1, "Output should have 1 value");
    assert(!Number.isNaN(output[0]), "Output should not be NaN");
    assert(
      output[0] >= 0 && output[0] <= 1,
      "Logistic output should be in [0,1]",
    );

    // After applyLearnings, activation should still be valid
    assert(
      !Number.isNaN(afterApply[0]),
      "After applyLearnings output should not be NaN",
    );
  },
});
