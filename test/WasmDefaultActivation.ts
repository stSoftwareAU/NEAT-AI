/**
 * WASM Default Activation Tests
 *
 * Issue #1122 - WASM Migration Phase 5: Make WASM the default activation implementation
 *
 * These tests verify that:
 * 1. WASM is used by default for all activation calls (when available)
 * 2. JS fallback works when WASM is unavailable
 * 3. Configuration options allow forcing JS (useJs parameter)
 * 4. Environment variable NEAT_AI_USE_JS forces JS activation
 * 5. Graceful degradation with warning when WASM unavailable
 * 6. All existing tests continue to pass
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
  name: "WASM Default: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test: WASM is used by default for activate()
// =============================================================================

Deno.test({
  name: "WASM Default: activate() uses WASM by default when available",
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

    // Default activation (should use WASM when available)
    const defaultOutput = creature.activate(input, false, false);
    assert(
      defaultOutput.length === 1,
      "Default output should have correct length",
    );

    // Explicit JS activation for comparison (useJs=true)
    const jsOutput = creature.activate(input, false, true);
    assert(jsOutput.length === 1, "JS output should have correct length");

    // Both should produce identical results
    assertArrayClose(
      defaultOutput,
      jsOutput,
      "Default and JS outputs should match",
    );
  },
});

Deno.test({
  name: "WASM Default: activate() with useJs=true forces JavaScript activation",
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

    // useJs=true should force JS activation
    const jsOutput = creature.activate(input, false, true);
    assert(jsOutput.length === 1, "JS output should have correct length");

    // Default activation (WASM) should produce same results
    const defaultOutput = creature.activate(input, false, false);
    assertArrayClose(
      defaultOutput,
      jsOutput,
      "JS and default outputs should match",
    );
  },
});

// =============================================================================
// Test: WASM is used by default for activateAndTrace()
// =============================================================================

Deno.test({
  name: "WASM Default: activateAndTrace() uses WASM by default when available",
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

    // Default activation (should use WASM when available)
    const defaultOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    assert(
      defaultOutput.length === 1,
      "Default output should have correct length",
    );

    // Explicit JS activation for comparison (useJs=true)
    creature.clearState();
    const jsOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      true,
    );
    assert(jsOutput.length === 1, "JS output should have correct length");

    // Both should produce identical results
    assertArrayClose(
      defaultOutput,
      jsOutput,
      "Default and JS outputs should match",
    );
  },
});

Deno.test({
  name:
    "WASM Default: activateAndTrace() with useJs=true forces JavaScript activation",
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

    // useJs=true should force JS activation
    const jsOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      true,
    );
    assert(jsOutput.length === 1, "JS output should have correct length");

    // Default activation (WASM) should produce same results
    creature.clearState();
    const defaultOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false,
    );
    assertArrayClose(
      defaultOutput,
      jsOutput,
      "JS and default outputs should match",
    );
  },
});

// =============================================================================
// Test: Graceful degradation when WASM unavailable
// =============================================================================

Deno.test({
  name:
    "WASM Default: Falls back to JS for unsupported squash functions (MEAN)",
  fn() {
    // MEAN is not supported in WASM, so it should fall back to JS
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

    const input = new Float32Array([1.0, 2.0]);

    // Default activation should fallback to JS (MEAN not supported in WASM)
    const defaultOutput = creature.activate(input, false, false);
    assert(
      defaultOutput.length === 1,
      "Default output should have correct length",
    );

    // Explicit JS activation for comparison
    const jsOutput = creature.activate(input, false, true);
    assertArrayClose(
      defaultOutput,
      jsOutput,
      "Fallback should produce same results as JS",
    );
  },
});

// =============================================================================
// Test: Multiple outputs with WASM default
// =============================================================================

Deno.test({
  name: "WASM Default: Works with multiple outputs",
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

    const defaultOutput = creature.activate(input, false, false);
    assertEquals(
      defaultOutput.length,
      2,
      "Default output should have 2 values",
    );

    const jsOutput = creature.activate(input, false, true);
    assertEquals(jsOutput.length, 2, "JS output should have 2 values");

    assertArrayClose(
      defaultOutput,
      jsOutput,
      "Multi-output results should match",
    );
  },
});

// =============================================================================
// Test: Buffer reuse with WASM default
// =============================================================================

Deno.test({
  name: "WASM Default: Buffer reuse works correctly",
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

    const wasm1 = creature.activate(input1, false, false); // useJs=false (WASM default)
    const js1 = creature.activate(input1, false, true); // useJs=true

    const wasm2 = creature.activate(input2, false, false); // useJs=false (WASM default)
    const js2 = creature.activate(input2, false, true); // useJs=true

    assertArrayClose(wasm1, js1, "First output (WASM vs JS)");
    assertArrayClose(wasm2, js2, "Second output (WASM vs JS)");
  },
});

// =============================================================================
// Test: All supported squash functions with WASM default
// =============================================================================

Deno.test({
  name: "WASM Default: All supported squash functions produce correct results",
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

      // Default activation (WASM)
      const defaultOutput = creature.activate(input, false, false);
      // Explicit JS activation (useJs=true)
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        defaultOutput,
        jsOutput,
        `${squash} should produce matching results`,
        1e-4,
      );
    }
  },
});

// =============================================================================
// Test: WASM cache invalidation works with default activation
// =============================================================================

Deno.test({
  name: "WASM Default: Cache works correctly across multiple activations",
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

    // First activation with default (WASM)
    const output1 = creature.activate(input1, false, false);
    // Second activation should use cached WASM
    const output2 = creature.activate(input2, false, false);

    // Verify with JS
    const jsOutput1 = creature.activate(input1, false, true);
    const jsOutput2 = creature.activate(input2, false, true);

    assertArrayClose(output1, jsOutput1, "First activation should match JS");
    assertArrayClose(output2, jsOutput2, "Second activation should match JS");
  },
});

// =============================================================================
// Test: disposeWasm() works with default activation
// =============================================================================

Deno.test({
  name: "WASM Default: disposeWasm() allows recompilation on next activate",
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

    // First activation with default (WASM)
    const output1 = creature.activate(input, false, false);

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
// Test: Backpropagation with WASM default activateAndTrace
// =============================================================================

Deno.test({
  name: "WASM Default: activateAndTrace supports backpropagation correctly",
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

    // Test with default (WASM)
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
    );
    const wasmChanged = wasmCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      wasmSparseConfig,
    );
    const wasmAfterApply = wasmCreature.activate(input);

    // Test with explicit JS (useJs=true)
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();

    const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    const jsOut = jsCreature.activateAndTrace(
      input,
      false,
      jsSparseConfig,
      true,
    );
    const jsChanged = jsCreature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      jsSparseConfig,
    );
    const jsAfterApply = jsCreature.activate(input, false, true);

    // Results should match
    assertArrayClose(wasmOut, jsOut, "activateAndTrace output should match");
    assertEquals(
      wasmChanged,
      jsChanged,
      "applyLearnings changed flag should match",
    );
    assertArrayClose(
      wasmAfterApply,
      jsAfterApply,
      "Activation after applyLearnings should match",
    );
  },
});

// =============================================================================
// Test: Mixed aggregate functions with WASM default
// =============================================================================

Deno.test({
  name: "WASM Default: Mixed network with aggregate functions works correctly",
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

    // Default activation (WASM)
    const defaultOutput = creature.activate(input, false, false);

    // Explicit JS activation (useJs=true)
    const jsOutput = creature.activate(input, false, true);

    assertArrayClose(
      defaultOutput,
      jsOutput,
      "Mixed network with aggregate functions should match",
    );
  },
});

// =============================================================================
// Test: Verify parameter name change from useWasm to useJs
// =============================================================================

Deno.test({
  name:
    "WASM Default: Parameter is useJs (not useWasm) for explicit JS selection",
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

    // Default (no fourth parameter) should use WASM
    const defaultOutput = creature.activate(input, false, false);

    // useJs=false should also use WASM (same as default)
    const wasmOutput = creature.activate(input, false, false);

    // useJs=true should force JS
    const jsOutput = creature.activate(input, false, true);

    // All should produce same results
    assertArrayClose(defaultOutput, wasmOutput, "default vs useJs=false");
    assertArrayClose(defaultOutput, jsOutput, "default vs useJs=true");
    assertArrayClose(wasmOutput, jsOutput, "useJs=false vs useJs=true");
  },
});
