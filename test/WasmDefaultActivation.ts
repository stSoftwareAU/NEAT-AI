/**
 * WASM Activation Tests
 *
 * Issue #1122 - WASM Migration Phase 5: Make WASM the default activation implementation
 * Issue #1123 - WASM Migration Phase 6: Remove deprecated JS activation
 *
 * These tests verify that:
 * 1. WASM activation works correctly for all supported squash functions
 * 2. Multiple outputs work correctly
 * 3. Buffer reuse works correctly
 * 4. WASM cache and recompilation work correctly
 * 5. Backpropagation with WASM activateAndTrace works correctly
 * 6. Unsupported squash functions throw appropriate errors
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
  name: "WASM Activation: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test: Basic WASM activation works correctly
// =============================================================================

Deno.test({
  name: "WASM Activation: Basic activate() works correctly",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);

    // Activation should work
    const output = creature.activate(input, false, false);
    assert(
      output.length === 1,
      "Output should have correct length",
    );
    assert(!Number.isNaN(output[0]), "Output should not be NaN");

    // Manual calculation: hidden = ReLU(1.0*1.0 + 0.5*-1.0 + 0.5) = ReLU(1.0) = 1.0
    // output = IDENTITY(1.0 * 2.0) = 2.0
    assertAlmostEquals(output[0], 2.0, TOLERANCE, "Output should be 2.0");
  },
});

// =============================================================================
// Test: Basic WASM activateAndTrace works correctly
// =============================================================================

Deno.test({
  name: "WASM Activation: Basic activateAndTrace() works correctly",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);
    const config = createBackPropagationConfig({ generations: 1 });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    // activateAndTrace should work
    const output = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    assert(
      output.length === 1,
      "Output should have correct length",
    );
    assert(!Number.isNaN(output[0]), "Output should not be NaN");
  },
});

// =============================================================================
// Test: Unsupported squash functions
// =============================================================================
// Note: Tests for MEAN squash function removed as part of Issue #1123
// (WASM Migration Phase 6) - this activation is no longer registered.

// =============================================================================
// Test: Multiple outputs with WASM
// =============================================================================

Deno.test({
  name: "WASM Activation: Works with multiple outputs",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
        { type: "output", index: 4, bias: 0.1, squash: "TANH" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
        { from: 2, to: 4, weight: 1.0 },
      ],
      input: 2,
      output: 2,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);

    const output = creature.activate(input, false, false);
    assertEquals(
      output.length,
      2,
      "Output should have 2 values",
    );
    assert(!Number.isNaN(output[0]), "Output[0] should not be NaN");
    assert(!Number.isNaN(output[1]), "Output[1] should not be NaN");
  },
});

// =============================================================================
// Test: Buffer reuse works correctly
// =============================================================================

Deno.test({
  name: "WASM Activation: Buffer reuse works correctly",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input1 = new Float32Array([1.0, 0.5]);
    const input2 = new Float32Array([2.0, 1.0]);

    // Copy results immediately since buffer is reused
    const output1 = new Float32Array(creature.activate(input1, false, true));
    const output2 = new Float32Array(creature.activate(input2, false, true));

    // Verify outputs are valid and different
    assert(!Number.isNaN(output1[0]), "Output1 should not be NaN");
    assert(!Number.isNaN(output2[0]), "Output2 should not be NaN");
    assert(
      output1[0] !== output2[0],
      "Different inputs should produce different outputs",
    );

    // Run again without buffer reuse and compare
    const output1NoBuf = creature.activate(input1, false, false);
    const output2NoBuf = creature.activate(input2, false, false);

    assertArrayClose(
      output1,
      output1NoBuf,
      "Buffer reuse should not affect result 1",
    );
    assertArrayClose(
      output2,
      output2NoBuf,
      "Buffer reuse should not affect result 2",
    );
  },
});

// =============================================================================
// Test: All supported squash functions produce correct results
// =============================================================================

Deno.test({
  name: "WASM Activation: All supported squash functions produce valid results",
  fn() {
    const supportedSquashFunctions = [
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
      "MINIMUM",
      "MAXIMUM",
      "IF",
    ];

    for (const squash of supportedSquashFunctions) {
      let creatureJson: CreatureInternal;

      if (squash === "IF") {
        creatureJson = {
          neurons: [
            { type: "hidden", index: 3, bias: 0, squash: "IF" },
            { type: "output", index: 4, bias: 0, squash: "IDENTITY" },
          ],
          synapses: [
            { from: 0, to: 3, weight: 1.0, type: "condition" },
            { from: 1, to: 3, weight: 1.0, type: "positive" },
            { from: 2, to: 3, weight: 1.0, type: "negative" },
            { from: 3, to: 4, weight: 1.0 },
          ],
          input: 3,
          output: 1,
        };
      } else if (squash === "MINIMUM" || squash === "MAXIMUM") {
        creatureJson = {
          neurons: [
            { type: "hidden", index: 2, bias: 0.1, squash: squash },
            { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
          ],
          synapses: [
            { from: 0, to: 2, weight: 1.0 },
            { from: 1, to: 2, weight: 1.0 },
            { from: 2, to: 3, weight: 1.0 },
          ],
          input: 2,
          output: 1,
        };
      } else {
        creatureJson = {
          neurons: [
            { type: "hidden", index: 2, bias: 0.1, squash: squash },
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
      }

      const creature = Creature.fromJSON(creatureJson);
      creature.fix();

      assert(
        creature.isWasmEligible(),
        `Creature with ${squash} should be WASM eligible`,
      );

      const inputSize = squash === "IF" ? 3 : 2;
      const input = new Float32Array(inputSize).fill(0.5);

      // Activation should work
      const output = creature.activate(input, false, false);
      assert(
        output.length === 1,
        `${squash} should produce output with correct length`,
      );
      assert(
        !Number.isNaN(output[0]),
        `${squash} output should not be NaN`,
      );
    }
  },
});

// =============================================================================
// Test: WASM cache works correctly across multiple activations
// =============================================================================

Deno.test({
  name: "WASM Activation: Cache works correctly across multiple activations",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input1 = new Float32Array([1.0, 0.5]);
    const input2 = new Float32Array([2.0, 1.0]);

    // First activation (WASM will be compiled)
    const output1 = new Float32Array(creature.activate(input1, false, false));
    // Second activation (should use cached WASM)
    const output2 = new Float32Array(creature.activate(input2, false, false));

    // Running the same inputs again should produce the same outputs
    const output1Again = creature.activate(input1, false, false);
    const output2Again = creature.activate(input2, false, false);

    assertArrayClose(
      output1,
      output1Again,
      "First activation should be consistent",
    );
    assertArrayClose(
      output2,
      output2Again,
      "Second activation should be consistent",
    );
  },
});

// =============================================================================
// Test: disposeWasm() allows recompilation on next activate
// =============================================================================

Deno.test({
  name: "WASM Activation: disposeWasm() allows recompilation on next activate",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);

    // First activation (WASM will be compiled)
    const output1 = new Float32Array(creature.activate(input, false, false));

    // Dispose WASM resources
    creature.disposeWasm();

    // Next activation should recompile WASM
    const output2 = creature.activate(input, false, false);

    assertArrayClose(
      output1,
      output2,
      "Results should be consistent after dispose and recompile",
    );
  },
});

// =============================================================================
// Test: Backpropagation with WASM activateAndTrace works correctly
// =============================================================================

Deno.test({
  name: "WASM Activation: activateAndTrace supports backpropagation correctly",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
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

    const input = new Float32Array([0.5, 0.5]);

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
    assertEquals(output.length, 1, "Output should have 1 value");
    assert(!Number.isNaN(output[0]), "Output should not be NaN");
    assert(
      output[0] >= 0 && output[0] <= 1,
      "Logistic output should be in [0,1]",
    );

    // Verify applyLearnings returns a boolean
    assert(
      typeof changed === "boolean",
      "applyLearnings should return boolean",
    );

    // After applyLearnings, activation should still be valid
    assert(
      !Number.isNaN(afterApply[0]),
      "After applyLearnings output should not be NaN",
    );
  },
});

// =============================================================================
// Test: Mixed network with aggregate functions works correctly
// =============================================================================

Deno.test({
  name:
    "WASM Activation: Mixed network with aggregate functions works correctly",
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

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([0.3, 0.5, 0.7]);

    // Activation should work
    const output = creature.activate(input, false, false);
    assertEquals(output.length, 1, "Output should have 1 value");
    assert(!Number.isNaN(output[0]), "Output should not be NaN");
    assert(
      output[0] >= 0 && output[0] <= 1,
      "Logistic output should be in [0,1]",
    );
  },
});

// =============================================================================
// Test: Consistent results across multiple activations with same input
// =============================================================================

Deno.test({
  name: "WASM Activation: Consistent results across multiple activations",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([1.0, 0.5]);

    // Run activation multiple times with same input
    const results: Float32Array[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(new Float32Array(creature.activate(input, false, false)));
    }

    // All results should be identical
    for (let i = 1; i < results.length; i++) {
      assertArrayClose(
        results[i],
        results[0],
        `Activation ${i} should match activation 0`,
      );
    }
  },
});
