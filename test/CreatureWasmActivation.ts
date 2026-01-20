/**
 * Creature WASM Activation Integration Tests
 *
 * Issue #1118 - WASM Migration Phase 1: Add WASM activation option to Creature class
 * Issue #1122 - WASM Migration Phase 5: Make WASM the default activation implementation
 * Issue #1123 - WASM Migration Phase 6: Remove deprecated JS activation code
 *
 * These tests verify that:
 * 1. Creature.activate() uses WASM for activation
 * 2. WASM eligibility detection works correctly
 * 3. WASM compilation is cached and lazily initialised
 * 4. All supported squash functions work correctly with WASM
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
  name: "Creature WASM: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test: WASM eligibility detection
// =============================================================================

Deno.test({
  name:
    "Creature WASM: isWasmEligible() returns true for supported squash functions",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "hidden", index: 3, bias: 0.3, squash: "TANH" },
        { type: "output", index: 4, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 3, weight: 1.0 },
        { from: 2, to: 4, weight: 1.0 },
        { from: 3, to: 4, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    assert(
      creature.isWasmEligible(),
      "Creature with supported squash functions should be WASM eligible",
    );
  },
});

Deno.test({
  name:
    "Creature WASM: isWasmEligible() returns false for unsupported squash functions (MEAN)",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "MEAN" },
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

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    assert(
      !creature.isWasmEligible(),
      "Creature with MEAN squash should NOT be WASM eligible",
    );
  },
});

Deno.test({
  name:
    "Creature WASM: isWasmEligible() returns false for unsupported squash functions (HYPOT)",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "HYPOT" },
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

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    assert(
      !creature.isWasmEligible(),
      "Creature with HYPOT squash should NOT be WASM eligible",
    );
  },
});

Deno.test({
  name:
    "Creature WASM: isWasmEligible() supports aggregate functions (IF, MINIMUM, MAXIMUM)",
  fn() {
    // IF function
    const ifCreatureJson: CreatureInternal = {
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
    const ifCreature = Creature.fromJSON(ifCreatureJson);
    ifCreature.fix();
    assert(
      ifCreature.isWasmEligible(),
      "Creature with IF should be WASM eligible",
    );

    // MINIMUM function
    const minCreatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0, squash: "MINIMUM" },
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
    const minCreature = Creature.fromJSON(minCreatureJson);
    minCreature.fix();
    assert(
      minCreature.isWasmEligible(),
      "Creature with MINIMUM should be WASM eligible",
    );

    // MAXIMUM function
    const maxCreatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0, squash: "MAXIMUM" },
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
    const maxCreature = Creature.fromJSON(maxCreatureJson);
    maxCreature.fix();
    assert(
      maxCreature.isWasmEligible(),
      "Creature with MAXIMUM should be WASM eligible",
    );
  },
});

// =============================================================================
// Test: WASM compilation caching
// =============================================================================

Deno.test({
  name: "Creature WASM: Caches compiled WASM activation",
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

    // First activation should compile
    const output1 = creature.activate(input1);
    assert(output1.length === 1);

    // Second activation should use cached WASM activation
    const output2 = creature.activate(input2);
    assert(output2.length === 1);

    // Verify expected outputs based on network structure:
    // input1: ReLU(1.0*1.0 + 0.5*(-1.0) + 0.5) = ReLU(1.0) = 1.0, then * 2.0 = 2.0
    assertAlmostEquals(
      output1[0],
      2.0,
      TOLERANCE,
      "First output should be 2.0",
    );
    // input2: ReLU(2.0*1.0 + 1.0*(-1.0) + 0.5) = ReLU(1.5) = 1.5, then * 2.0 = 3.0
    assertAlmostEquals(
      output2[0],
      3.0,
      TOLERANCE,
      "Second output should be 3.0",
    );
  },
});

// =============================================================================
// Test: WASM cache invalidation on structural changes
// =============================================================================

Deno.test({
  name: "Creature WASM: Invalidates cache on clearState()",
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

    // Activate to compile and cache
    const output1 = creature.activate(input);

    // Clear state (simulates structural change)
    creature.clearState();

    // Should still work after clearState (will recompile if needed)
    const output2 = creature.activate(input);

    assertArrayClose(
      output1,
      output2,
      "Results should be consistent after clearState",
    );
  },
});

// =============================================================================
// Test: Buffer reuse with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: Buffer reuse works correctly",
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

    // Activate with buffer reuse - copy immediately to avoid overwrite
    const output1 = new Float32Array(creature.activate(input1, false, true));
    const output2 = new Float32Array(creature.activate(input2, false, true));

    // Verify expected outputs
    // input1: ReLU(1.0 - 0.5 + 0.5) = 1.0, then * 2.0 = 2.0
    assertAlmostEquals(
      output1[0],
      2.0,
      TOLERANCE,
      "First output with buffer reuse",
    );
    // input2: ReLU(2.0 - 1.0 + 0.5) = 1.5, then * 2.0 = 3.0
    assertAlmostEquals(
      output2[0],
      3.0,
      TOLERANCE,
      "Second output with buffer reuse",
    );
  },
});

// =============================================================================
// Test: Multiple outputs with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: Works with multiple outputs",
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
    const output = creature.activate(input);

    assertEquals(output.length, 2, "Output should have 2 values");

    // First output: ReLU(1.0 - 0.5 + 0.5) * 2.0 = 2.0
    assertAlmostEquals(output[0], 2.0, TOLERANCE, "First output");
    // Second output: TANH(ReLU(1.0) + 0.1) = TANH(1.1) ≈ 0.8
    assert(
      output[1] > 0.7 && output[1] < 0.9,
      "Second output should be TANH of ~1.1",
    );
  },
});

// =============================================================================
// Test: Constant neurons with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: Works with constant neurons",
  fn() {
    // Constant neuron placed after input neurons (at index 1)
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "constant", index: 1, bias: 0.5 },
        { type: "hidden", index: 2, bias: 0, squash: "IDENTITY" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 }, // input -> hidden
        { from: 1, to: 2, weight: 2.0 }, // constant -> hidden
        { from: 2, to: 3, weight: 1.0 }, // hidden -> output
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([3.0]);
    const output = creature.activate(input);

    // Input neuron (index 0) contributes 3.0 * 1.0 = 3.0
    // Constant neuron (index 1, bias 0.5) contributes 0.5 * 2.0 = 1.0
    // Hidden (index 2): 3.0 + 1.0 = 4.0
    // Output (index 3): 4.0 * 1.0 = 4.0
    assertAlmostEquals(output[0], 4.0, TOLERANCE, "Constant neuron result");
  },
});

// =============================================================================
// Test: activateAndTrace() with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: activateAndTrace() works correctly",
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
    const creatureExport = creature.exportJSON();
    const config = createBackPropagationConfig({
      generations: 1,
    });
    const sparseConfig = new SparseConfig(creatureExport, config);

    const output = creature.activateAndTrace(input, false, sparseConfig);

    assertEquals(output.length, 1, "Output should have correct length");
    // ReLU(1.0 - 0.5 + 0.5) * 2.0 = 2.0
    assertAlmostEquals(output[0], 2.0, TOLERANCE, "activateAndTrace result");
  },
});

// =============================================================================
// Test: All supported squash functions with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: All supported squash functions produce correct results",
  fn() {
    // List of all WASM-supported squash functions
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
      // Create creature with specific squash function
      let creatureJson: CreatureInternal;

      if (squash === "IF") {
        // IF requires special synapse types
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
        // Aggregate functions need multiple inputs
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
        // Standard squash function
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

      // Use safe input values that won't cause issues with TAN, SQRT etc.
      const inputSize = squash === "IF" ? 3 : 2;
      const input = new Float32Array(inputSize).fill(0.5);

      const output = creature.activate(input);

      assert(
        output.length === 1,
        `${squash} should produce output of length 1`,
      );
      assert(
        Number.isFinite(output[0]),
        `${squash} should produce finite output`,
      );
    }
  },
});

// =============================================================================
// Test: getUnsupportedWasmSquashFunctions()
// =============================================================================

Deno.test({
  name:
    "Creature WASM: getUnsupportedWasmSquashFunctions() returns correct list",
  fn() {
    // Creature with MEAN (unsupported)
    const meanCreatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "MEAN" },
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

    const meanCreature = Creature.fromJSON(meanCreatureJson);
    meanCreature.fix();

    const unsupported = meanCreature.getUnsupportedWasmSquashFunctions();
    assert(unsupported.includes("MEAN"), "Should report MEAN as unsupported");

    // Creature with all supported squash functions
    const supportedCreatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const supportedCreature = Creature.fromJSON(supportedCreatureJson);
    supportedCreature.fix();

    const supportedUnsupported = supportedCreature
      .getUnsupportedWasmSquashFunctions();
    assertEquals(
      supportedUnsupported.length,
      0,
      "Should have no unsupported squash functions",
    );
  },
});

// =============================================================================
// Test: dispose() cleans up WASM resources
// =============================================================================

Deno.test({
  name: "Creature WASM: disposeWasm() cleans up WASM resources",
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

    // Activate to compile and cache
    creature.activate(input);

    // Dispose WASM resources
    creature.disposeWasm();

    // Should still work after dispose (will recompile on next activation)
    const output = creature.activate(input);
    assert(output.length === 1, "Should still produce output after dispose");
  },
});
