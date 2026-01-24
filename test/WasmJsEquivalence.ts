/**
 * Comprehensive WASM vs JS Equivalence Tests
 *
 * Issue #1161 - Confirm WASM and JS implementations are equivalent
 *
 * These tests verify that WASM and JavaScript implementations produce
 * identical results across the full range of NEAT-AI functionality:
 *
 * 1. Forward activation - all activation functions
 * 2. Backpropagation - activateAndTrace with learning
 * 3. Multi-layer networks - complex creature topologies
 * 4. Aggregate functions - IF, MINIMUM, MAXIMUM
 * 5. Edge cases - boundary values, extreme inputs
 * 6. Sequential activations - state consistency
 * 7. Feedback loops - recurrent network behaviour
 *
 * Purpose: Confirm WASM can replace JS with no fallback required.
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
const TOLERANCE = 1e-4;

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
    `${
      message ?? ""
    }: Array lengths differ (actual: ${actual.length}, expected: ${expected.length})`,
  );
  for (let i = 0; i < actual.length; i++) {
    assertAlmostEquals(
      actual[i],
      expected[i],
      tolerance,
      `${message ?? ""}[${i}]: actual=${actual[i]}, expected=${expected[i]}`,
    );
  }
}

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// All WASM-supported activation functions
const ALL_ACTIVATIONS = [
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

// Aggregate functions
const AGGREGATE_ACTIVATIONS = ["MINIMUM", "MAXIMUM", "IF"];

// =============================================================================
// Test Setup: Initialise WASM
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test 1: Single Neuron Activation Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Single neuron - all activation functions",
  fn() {
    // Standard test inputs that work well for most activations
    const testInputs = [
      -2.0,
      -1.0,
      -0.5,
      -0.1,
      0.0,
      0.1,
      0.5,
      1.0,
      2.0,
    ];

    // Some activations have special ranges or produce extreme values for certain inputs
    // Use more conservative test inputs for these
    const conservativeInputs = [
      -1.0,
      -0.5,
      0.5,
      1.0,
    ];

    // Activations that need conservative inputs to avoid numerical instability
    const conservativeActivations = new Set([
      "StdInverse", // f(x) = 1/x can explode near zero
      "TAN", // tan is unbounded and periodic
      "Exponential", // e^x explodes for large inputs
      "SQRT", // sqrt(x) requires x >= 0
    ]);

    for (const squash of ALL_ACTIVATIONS) {
      const creatureJson: CreatureInternal = {
        neurons: [
          { type: "output", index: 1, bias: 0.1, squash },
        ],
        synapses: [{ from: 0, to: 1, weight: 1.0 }],
        input: 1,
        output: 1,
      };

      const creature = Creature.fromJSON(creatureJson);
      creature.fix();

      const inputsToUse = conservativeActivations.has(squash)
        ? conservativeInputs
        : testInputs;

      for (const inputVal of inputsToUse) {
        const input = new Float32Array([inputVal]);

        // WASM activation (default)
        const wasmOutput = creature.activate(input, false, false);
        // JS activation (explicit)
        const jsOutput = creature.activate(input, false, true);

        // Skip comparison if either result is non-finite
        if (
          !Number.isFinite(wasmOutput[0]) || !Number.isFinite(jsOutput[0])
        ) {
          continue;
        }

        // For very large values, use relative tolerance
        const maxVal = Math.max(Math.abs(wasmOutput[0]), Math.abs(jsOutput[0]));
        const tolerance = maxVal > 1000 ? maxVal * 1e-3 : TOLERANCE;

        assertArrayClose(
          wasmOutput,
          jsOutput,
          `${squash} at input=${inputVal}`,
          tolerance,
        );
      }
    }
  },
});

// =============================================================================
// Test 2: Multi-Input Network Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Multi-input network - weighted sum verification",
  fn() {
    for (const squash of ALL_ACTIVATIONS) {
      const creatureJson: CreatureInternal = {
        neurons: [
          { type: "output", index: 3, bias: 0.1, squash },
        ],
        synapses: [
          { from: 0, to: 3, weight: 0.5 },
          { from: 1, to: 3, weight: -0.3 },
          { from: 2, to: 3, weight: 0.8 },
        ],
        input: 3,
        output: 1,
      };

      const creature = Creature.fromJSON(creatureJson);
      creature.fix();

      const testCases = [
        [0.0, 0.0, 0.0],
        [1.0, 1.0, 1.0],
        [-1.0, -1.0, -1.0],
        [0.5, -0.5, 0.5],
        [2.0, -1.0, 0.5],
      ];

      for (const inputVals of testCases) {
        const input = new Float32Array(inputVals);

        const wasmOutput = creature.activate(input, false, false);
        const jsOutput = creature.activate(input, false, true);

        assertArrayClose(
          wasmOutput,
          jsOutput,
          `${squash} multi-input at [${inputVals}]`,
        );
      }
    }
  },
});

// =============================================================================
// Test 3: Multi-Layer Network Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Multi-layer network - deep topology",
  fn() {
    // Test with each activation in a 3-layer network
    for (const squash of ALL_ACTIVATIONS) {
      const creatureJson: CreatureInternal = {
        neurons: [
          // Hidden layer 1
          { type: "hidden", index: 2, bias: 0.1, squash },
          { type: "hidden", index: 3, bias: -0.1, squash },
          // Hidden layer 2
          { type: "hidden", index: 4, bias: 0.2, squash },
          { type: "hidden", index: 5, bias: -0.2, squash },
          // Output layer
          { type: "output", index: 6, bias: 0.0, squash: "IDENTITY" },
        ],
        synapses: [
          // Input to hidden 1
          { from: 0, to: 2, weight: 0.5 },
          { from: 0, to: 3, weight: -0.5 },
          { from: 1, to: 2, weight: 0.3 },
          { from: 1, to: 3, weight: 0.3 },
          // Hidden 1 to hidden 2
          { from: 2, to: 4, weight: 0.7 },
          { from: 2, to: 5, weight: -0.4 },
          { from: 3, to: 4, weight: 0.4 },
          { from: 3, to: 5, weight: 0.6 },
          // Hidden 2 to output
          { from: 4, to: 6, weight: 1.0 },
          { from: 5, to: 6, weight: 1.0 },
        ],
        input: 2,
        output: 1,
      };

      const creature = Creature.fromJSON(creatureJson);
      creature.fix();

      const testCases = [
        [0.0, 0.0],
        [1.0, 0.0],
        [0.0, 1.0],
        [1.0, 1.0],
        [-1.0, 1.0],
        [0.5, -0.5],
      ];

      for (const inputVals of testCases) {
        const input = new Float32Array(inputVals);

        const wasmOutput = creature.activate(input, false, false);
        const jsOutput = creature.activate(input, false, true);

        assertArrayClose(
          wasmOutput,
          jsOutput,
          `${squash} deep network at [${inputVals}]`,
        );
      }
    }
  },
});

// =============================================================================
// Test 4: Aggregate Function Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: MINIMUM aggregate function",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.0, squash: "MINIMUM" },
        { type: "output", index: 3, bias: 0.0, squash: "IDENTITY" },
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

    const testCases = [
      [1.0, 2.0], // min = 1.0
      [2.0, 1.0], // min = 1.0
      [-1.0, 1.0], // min = -1.0
      [0.5, 0.5], // min = 0.5
      [-2.0, -1.0], // min = -2.0
    ];

    for (const inputVals of testCases) {
      const input = new Float32Array(inputVals);

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `MINIMUM at [${inputVals}]`,
      );
    }
  },
});

Deno.test({
  name: "WASM/JS Equivalence: MAXIMUM aggregate function",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.0, squash: "MAXIMUM" },
        { type: "output", index: 3, bias: 0.0, squash: "IDENTITY" },
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

    const testCases = [
      [1.0, 2.0], // max = 2.0
      [2.0, 1.0], // max = 2.0
      [-1.0, 1.0], // max = 1.0
      [0.5, 0.5], // max = 0.5
      [-2.0, -1.0], // max = -1.0
    ];

    for (const inputVals of testCases) {
      const input = new Float32Array(inputVals);

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `MAXIMUM at [${inputVals}]`,
      );
    }
  },
});

Deno.test({
  name: "WASM/JS Equivalence: IF aggregate function",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 3, bias: 0.0, squash: "IF" },
        { type: "output", index: 4, bias: 0.0, squash: "IDENTITY" },
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

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const testCases = [
      [1.0, 10.0, 5.0], // condition > 0, return positive = 10.0
      [-1.0, 10.0, 5.0], // condition < 0, return negative = 5.0
      [0.0, 10.0, 5.0], // condition == 0, return negative = 5.0
      [0.5, 2.0, 3.0], // condition > 0, return positive = 2.0
      [-0.5, 2.0, 3.0], // condition < 0, return negative = 3.0
    ];

    for (const inputVals of testCases) {
      const input = new Float32Array(inputVals);

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `IF at [${inputVals}]`,
      );
    }
  },
});

// =============================================================================
// Test 5: Multiple Outputs Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Multiple outputs - classification network",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        // Hidden layer
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 3, bias: -0.1, squash: "TANH" },
        { type: "hidden", index: 4, bias: 0.2, squash: "LOGISTIC" },
        // Output layer - 3 outputs
        { type: "output", index: 5, bias: 0.0, squash: "LOGISTIC" },
        { type: "output", index: 6, bias: 0.0, squash: "LOGISTIC" },
        { type: "output", index: 7, bias: 0.0, squash: "LOGISTIC" },
      ],
      synapses: [
        // Input to hidden
        { from: 0, to: 2, weight: 0.5 },
        { from: 0, to: 3, weight: -0.3 },
        { from: 1, to: 3, weight: 0.4 },
        { from: 1, to: 4, weight: 0.6 },
        // Hidden to output
        { from: 2, to: 5, weight: 1.0 },
        { from: 2, to: 6, weight: 0.5 },
        { from: 3, to: 5, weight: 0.5 },
        { from: 3, to: 6, weight: 1.0 },
        { from: 3, to: 7, weight: 0.3 },
        { from: 4, to: 6, weight: 0.5 },
        { from: 4, to: 7, weight: 1.0 },
      ],
      input: 2,
      output: 3,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const testCases = [
      [0.0, 0.0],
      [1.0, 0.0],
      [0.0, 1.0],
      [1.0, 1.0],
      [-1.0, 1.0],
      [0.5, -0.5],
      [2.0, -2.0],
    ];

    for (const inputVals of testCases) {
      const input = new Float32Array(inputVals);

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertEquals(wasmOutput.length, 3, "Should have 3 outputs");
      assertEquals(jsOutput.length, 3, "Should have 3 outputs");

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Multi-output at [${inputVals}]`,
      );
    }
  },
});

// =============================================================================
// Test 6: activateAndTrace Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: activateAndTrace - trace data consistency",
  fn() {
    for (const squash of ["ReLU", "TANH", "LOGISTIC", "SELU", "Swish"]) {
      const creatureJson: CreatureInternal = {
        neurons: [
          { type: "hidden", index: 2, bias: 0.1, squash },
          { type: "hidden", index: 3, bias: -0.1, squash },
          { type: "output", index: 4, bias: 0.0, squash: "IDENTITY" },
        ],
        synapses: [
          { from: 0, to: 2, weight: 0.5 },
          { from: 1, to: 2, weight: -0.3 },
          { from: 0, to: 3, weight: 0.4 },
          { from: 1, to: 3, weight: 0.6 },
          { from: 2, to: 4, weight: 1.0 },
          { from: 3, to: 4, weight: 1.0 },
        ],
        input: 2,
        output: 1,
      };

      const input = new Float32Array([0.5, -0.5]);

      // Test with WASM
      const wasmCreature = Creature.fromJSON(creatureJson);
      wasmCreature.validate();
      const wasmConfig = createBackPropagationConfig({ sparseRatio: 1 });
      const wasmSparseConfig = new SparseConfig(
        wasmCreature.exportJSON(),
        wasmConfig,
      );
      const wasmOutput = wasmCreature.activateAndTrace(
        input,
        false,
        wasmSparseConfig,
        false, // useJs = false (WASM)
      );

      // Test with JS
      const jsCreature = Creature.fromJSON(creatureJson);
      jsCreature.validate();
      const jsConfig = createBackPropagationConfig({ sparseRatio: 1 });
      const jsSparseConfig = new SparseConfig(
        jsCreature.exportJSON(),
        jsConfig,
      );
      const jsOutput = jsCreature.activateAndTrace(
        input,
        false,
        jsSparseConfig,
        true, // useJs = true
      );

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `${squash} activateAndTrace output`,
      );
    }
  },
});

// =============================================================================
// Test 7: Backpropagation and Learning Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Backpropagation - applyLearnings consistency",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 3, bias: -0.1, squash: "TANH" },
        { type: "output", index: 4, bias: 0.0, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: -0.3 },
        { from: 0, to: 3, weight: 0.4 },
        { from: 1, to: 3, weight: 0.6 },
        { from: 2, to: 4, weight: 1.0 },
        { from: 3, to: 4, weight: 0.5 },
      ],
      input: 2,
      output: 1,
    };

    const inputs = [
      new Float32Array([0.5, 0.5]),
      new Float32Array([1.0, 0.0]),
      new Float32Array([0.0, 1.0]),
    ];
    const targets = [
      new Float32Array([0.8]),
      new Float32Array([0.2]),
      new Float32Array([0.6]),
    ];

    // Train with WASM
    const wasmCreature = Creature.fromJSON(creatureJson);
    wasmCreature.validate();
    const wasmConfig = createBackPropagationConfig({
      sparseRatio: 1,
      trainingMutationRate: 0.5,
    });
    const wasmSparseConfig = new SparseConfig(
      wasmCreature.exportJSON(),
      wasmConfig,
    );

    for (let i = 0; i < inputs.length; i++) {
      wasmCreature.activateAndTrace(
        inputs[i],
        false,
        wasmSparseConfig,
        false, // useJs = false (WASM)
      );
      wasmCreature.propagate(targets[i], wasmConfig, wasmSparseConfig);
    }
    const wasmChanged = wasmCreature.applyLearnings(
      wasmConfig,
      wasmSparseConfig,
    );

    // Train with JS
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.validate();
    const jsConfig = createBackPropagationConfig({
      sparseRatio: 1,
      trainingMutationRate: 0.5,
    });
    const jsSparseConfig = new SparseConfig(jsCreature.exportJSON(), jsConfig);

    for (let i = 0; i < inputs.length; i++) {
      jsCreature.activateAndTrace(
        inputs[i],
        false,
        jsSparseConfig,
        true, // useJs = true
      );
      jsCreature.propagate(targets[i], jsConfig, jsSparseConfig);
    }
    const jsChanged = jsCreature.applyLearnings(jsConfig, jsSparseConfig);

    // Both should have similar learning behaviour
    assertEquals(
      wasmChanged,
      jsChanged,
      "applyLearnings changed flag should match",
    );

    // Verify outputs after learning are close
    const testInput = new Float32Array([0.7, 0.3]);
    const wasmAfter = wasmCreature.activate(testInput, false, false);
    const jsAfter = jsCreature.activate(testInput, false, true);

    assertArrayClose(
      wasmAfter,
      jsAfter,
      "Activation after learning should match",
      1e-2, // Larger tolerance for accumulated differences in backpropagation
    );
  },
});

// =============================================================================
// Test 8: Sequential Activation Consistency
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Sequential activations - state consistency",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "TANH" },
        { type: "output", index: 3, bias: 0.0, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: -0.3 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    // Perform 10 sequential activations
    const inputs = Array.from(
      { length: 10 },
      () => new Float32Array([Math.random() * 2 - 1, Math.random() * 2 - 1]),
    );

    for (let i = 0; i < inputs.length; i++) {
      const wasmOutput = creature.activate(inputs[i], false, false);
      const jsOutput = creature.activate(inputs[i], false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Sequential activation ${i + 1}`,
      );
    }
  },
});

// =============================================================================
// Test 9: Feedback Loop Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Feedback loops - recurrent behaviour",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "TANH" },
        { type: "output", index: 3, bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: -0.3 },
        { from: 2, to: 3, weight: 1.0 },
        // Feedback connection
        { from: 3, to: 2, weight: 0.2 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([0.5, 0.3]);

    // Test with feedbackLoop = true
    creature.clearState();
    const wasmOutput1 = creature.activate(input, true, false);
    const jsCreature = Creature.fromJSON(creatureJson);
    jsCreature.fix();
    jsCreature.clearState();
    const jsOutput1 = jsCreature.activate(input, true, true);

    assertArrayClose(wasmOutput1, jsOutput1, "Feedback loop activation 1");

    // Second activation should use feedback
    const wasmOutput2 = creature.activate(input, true, false);
    const jsOutput2 = jsCreature.activate(input, true, true);

    assertArrayClose(wasmOutput2, jsOutput2, "Feedback loop activation 2");

    // Third activation
    const wasmOutput3 = creature.activate(input, true, false);
    const jsOutput3 = jsCreature.activate(input, true, true);

    assertArrayClose(wasmOutput3, jsOutput3, "Feedback loop activation 3");
  },
});

// =============================================================================
// Test 10: Edge Cases and Boundary Values
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Edge cases - extreme input values",
  fn() {
    const extremeValues = [
      -1000.0,
      -100.0,
      -10.0,
      -1.0,
      -0.001,
      0.0,
      0.001,
      1.0,
      10.0,
      100.0,
      1000.0,
    ];

    // Test with bounded activations
    const boundedActivations = ["LOGISTIC", "TANH", "GAUSSIAN", "ReLU6"];

    for (const squash of boundedActivations) {
      const creatureJson: CreatureInternal = {
        neurons: [{ type: "output", index: 1, bias: 0.0, squash }],
        synapses: [{ from: 0, to: 1, weight: 1.0 }],
        input: 1,
        output: 1,
      };

      const creature = Creature.fromJSON(creatureJson);
      creature.fix();

      for (const val of extremeValues) {
        const input = new Float32Array([val]);

        const wasmOutput = creature.activate(input, false, false);
        const jsOutput = creature.activate(input, false, true);

        // For extreme values, both should produce finite, bounded results
        assert(
          Number.isFinite(wasmOutput[0]),
          `${squash} WASM output should be finite for input ${val}`,
        );
        assert(
          Number.isFinite(jsOutput[0]),
          `${squash} JS output should be finite for input ${val}`,
        );

        assertArrayClose(
          wasmOutput,
          jsOutput,
          `${squash} at extreme input ${val}`,
        );
      }
    }
  },
});

// =============================================================================
// Test 11: Large Network Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Large network - 100 neurons",
  fn() {
    // Create a larger network with 10 inputs, 80 hidden, 10 outputs
    const neurons: CreatureInternal["neurons"] = [];
    const synapses: CreatureInternal["synapses"] = [];

    const numInputs = 10;
    const numHidden = 80;
    const numOutputs = 10;

    const activations = ["ReLU", "TANH", "LOGISTIC", "SELU", "Swish"];

    // Hidden neurons
    for (let i = 0; i < numHidden; i++) {
      const squash = activations[i % activations.length];
      neurons.push({
        type: "hidden",
        index: numInputs + i,
        bias: (Math.random() - 0.5) * 0.5,
        squash,
      });
    }

    // Output neurons
    for (let i = 0; i < numOutputs; i++) {
      neurons.push({
        type: "output",
        index: numInputs + numHidden + i,
        bias: 0,
        squash: "LOGISTIC",
      });
    }

    // Synapses: input to first hidden layer
    for (let i = 0; i < numInputs; i++) {
      for (let h = 0; h < 10; h++) {
        synapses.push({
          from: i,
          to: numInputs + h,
          weight: (Math.random() - 0.5) * 2,
        });
      }
    }

    // Hidden to hidden (layered)
    const layerSize = 20;
    for (let layer = 0; layer < 3; layer++) {
      const start = layer * layerSize;
      const end = start + layerSize;
      const nextStart = end;
      const nextEnd = Math.min(nextStart + layerSize, numHidden);

      for (let from = start; from < end; from++) {
        for (let to = nextStart; to < nextEnd; to++) {
          if (Math.random() > 0.5) {
            synapses.push({
              from: numInputs + from,
              to: numInputs + to,
              weight: (Math.random() - 0.5) * 2,
            });
          }
        }
      }
    }

    // Last hidden to outputs
    for (let h = numHidden - 20; h < numHidden; h++) {
      for (let o = 0; o < numOutputs; o++) {
        synapses.push({
          from: numInputs + h,
          to: numInputs + numHidden + o,
          weight: (Math.random() - 0.5) * 2,
        });
      }
    }

    const creatureJson: CreatureInternal = {
      neurons,
      synapses,
      input: numInputs,
      output: numOutputs,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    // Test with multiple random inputs
    for (let t = 0; t < 10; t++) {
      const input = new Float32Array(numInputs);
      for (let i = 0; i < numInputs; i++) {
        input[i] = Math.random() * 2 - 1;
      }

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Large network test ${t + 1}`,
        1e-3, // Slightly larger tolerance for accumulated numerical differences
      );
    }
  },
});

// =============================================================================
// Test 12: Mixed Activation Network
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Mixed activations - all types in one network",
  fn() {
    // Create a network using all activation types
    const neurons: CreatureInternal["neurons"] = [];
    const synapses: CreatureInternal["synapses"] = [];

    const numInputs = 3;
    let currentIndex = numInputs;

    // Add a hidden neuron for each activation type
    for (const squash of ALL_ACTIVATIONS) {
      neurons.push({
        type: "hidden",
        index: currentIndex,
        bias: 0.1,
        squash,
      });

      // Connect from all inputs
      for (let i = 0; i < numInputs; i++) {
        synapses.push({
          from: i,
          to: currentIndex,
          weight: 0.3,
        });
      }
      currentIndex++;
    }

    // Add output neuron
    neurons.push({
      type: "output",
      index: currentIndex,
      bias: 0,
      squash: "IDENTITY",
    });

    // Connect all hidden to output
    for (let h = numInputs; h < currentIndex; h++) {
      synapses.push({
        from: h,
        to: currentIndex,
        weight: 1.0 / ALL_ACTIVATIONS.length,
      });
    }

    const creatureJson: CreatureInternal = {
      neurons,
      synapses,
      input: numInputs,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const testCases = [
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
    ];

    for (const inputVals of testCases) {
      const input = new Float32Array(inputVals);

      const wasmOutput = creature.activate(input, false, false);
      const jsOutput = creature.activate(input, false, true);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Mixed activations at [${inputVals}]`,
        1e-3,
      );
    }
  },
});

// =============================================================================
// Test 13: Buffer Reuse Equivalence
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Buffer reuse - consistent results",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
        { type: "output", index: 3, bias: 0.0, squash: "TANH" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: -0.3 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const inputs = [
      new Float32Array([0.5, 0.5]),
      new Float32Array([1.0, 0.0]),
      new Float32Array([0.0, 1.0]),
      new Float32Array([-0.5, 0.5]),
    ];

    for (let i = 0; i < inputs.length; i++) {
      const wasmOut = creature.activate(inputs[i], false, false);
      const jsOut = creature.activate(inputs[i], false, true);
      assertArrayClose(wasmOut, jsOut, `WASM vs JS ${i + 1}`);
    }
  },
});

// =============================================================================
// Test 14: Comprehensive Equivalence Summary
// =============================================================================

Deno.test({
  name: "WASM/JS Equivalence: Comprehensive verification summary",
  fn() {
    let passCount = 0;
    let totalCount = 0;
    const failures: string[] = [];

    // Test each activation with multiple input patterns
    for (const squash of [...ALL_ACTIVATIONS, ...AGGREGATE_ACTIVATIONS]) {
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
            { type: "hidden", index: 2, bias: 0, squash },
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
            { type: "hidden", index: 2, bias: 0.1, squash },
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

      const inputSize = squash === "IF" ? 3 : 2;
      const testInputs = [
        Array(inputSize).fill(0.0),
        Array(inputSize).fill(0.5),
        Array(inputSize).fill(-0.5),
        Array(inputSize).fill(1.0),
      ];

      for (const inputVals of testInputs) {
        totalCount++;
        const input = new Float32Array(inputVals);

        try {
          const wasmOutput = creature.activate(input, false, false);
          const jsOutput = creature.activate(input, false, true);

          let match = true;
          for (let i = 0; i < wasmOutput.length; i++) {
            const diff = Math.abs(wasmOutput[i] - jsOutput[i]);
            if (diff > TOLERANCE && diff > Math.abs(jsOutput[i]) * TOLERANCE) {
              match = false;
              break;
            }
          }

          if (match) {
            passCount++;
          } else {
            failures.push(`${squash} at [${inputVals}]`);
          }
        } catch (err) {
          failures.push(`${squash} at [${inputVals}]: ${err}`);
        }
      }
    }

    console.log(
      `\nComprehensive Equivalence: ${passCount}/${totalCount} tests passed`,
    );

    if (failures.length > 0) {
      console.log("Failures:");
      for (const f of failures) {
        console.log(`  - ${f}`);
      }
    }

    assertEquals(passCount, totalCount, "All equivalence tests should pass");
  },
});
