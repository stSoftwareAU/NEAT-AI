/**
 * Creature WASM Activation Integration Tests
 *
 * Issue #1118 - WASM Migration Phase 1: Add WASM activation option to Creature class
 * Issue #1122 - WASM Migration Phase 5: Make WASM the default activation implementation
 *
 * These tests verify that:
 * 1. Creature.activate() uses WASM by default (useJs parameter forces JS)
 * 2. WASM is required on the default path; unsupported squash functions throw
 * 3. WASM eligibility detection works correctly
 * 4. WASM compilation is cached and lazily initialised
 * 5. Both JS and WASM paths produce identical results
 *
 * Note: Issue #1229 removes the default-path JS fallback. Use `useJs: true`
 * or `NEAT_AI_USE_JS_ACTIVATION=1` for verification only.
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
  name: "Creature WASM: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// =============================================================================
// Test: activate() with useJs parameter (Issue #1122: parameter renamed from useWasm)
// =============================================================================

Deno.test({
  name: "Creature WASM: activate() accepts useJs parameter",
  fn() {
    // Create a simple creature with WASM-compatible squash functions
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

    // Should work with useJs=true (explicit JS)
    const jsOutput = creature.activate(input, false, true);
    assert(jsOutput.length === 1, "JS output should have correct length");

    // Should work with useJs=false (WASM - default)
    const wasmOutput = creature.activate(input, false, false);
    assert(wasmOutput.length === 1, "WASM output should have correct length");

    // Both should produce identical results
    assertArrayClose(wasmOutput, jsOutput, "JS and WASM outputs should match");
  },
});

Deno.test({
  name: "Creature WASM: activate() with WASM produces same results as JS",
  fn() {
    // Create a creature with multiple supported squash functions
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 3, bias: 0.2, squash: "TANH" },
        { type: "hidden", index: 4, bias: 0.3, squash: "LOGISTIC" },
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

    // Test with various inputs
    const testCases = [
      new Float32Array([1.0, 0.0]),
      new Float32Array([0.0, 1.0]),
      new Float32Array([1.0, 1.0]),
      new Float32Array([-1.0, -1.0]),
      new Float32Array([2.0, 0.5]),
      new Float32Array([-0.5, 0.5]),
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false, true); // useJs=true
      const wasmOutput = creature.activate(input, false, false); // useJs=false (WASM)
      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Input: [${input.join(", ")}]`,
      );
    }
  },
});

// =============================================================================
// Regression: JS vs WASM parity for large inputs
// =============================================================================

Deno.test({
  name: "Creature WASM: activate() parity with large input (regression)",
  fn() {
    // Large-input creatures are common in production. We validate that JS-forced
    // and WASM-default remain close for a representative (non-adversarial) weight
    // scale.
    //
    // Note: there exist adversarial cancellation cases where f32 vs f64 can
    // diverge materially. We do not treat those as a hard parity guarantee here.

    function seededRandom(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    }

    const N = 512;
    const rand = seededRandom(123456);
    const weights: number[] = new Array(N);
    const input = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      input[i] = rand() * 2 - 1; // [-1, 1]
      weights[i] = (rand() * 2 - 1) * 1e4; // moderate scale
    }

    const outputIndex = N;
    const creatureJson: CreatureInternal = {
      neurons: [{
        type: "output",
        index: outputIndex,
        bias: 0,
        squash: "HARD_TANH",
      }],
      synapses: weights.map((w, i) => ({
        from: i,
        to: outputIndex,
        weight: w,
      })),
      input: N,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const jsOutput = creature.activate(input, false, true);
    const wasmOutput = creature.activate(input, false, false);

    assertArrayClose(wasmOutput, jsOutput, "Large-input parity", 1e-4);
  },
});

// =============================================================================
// Regression: squash parity for large values (Exponential)
// =============================================================================

Deno.test({
  name: "Creature WASM: Exponential clamp parity at large x (regression)",
  fn() {
    // JS Exponential clamps at x>=36 to Number.MAX_SAFE_INTEGER.
    // WASM must match to avoid runaway values (and NaNs downstream).
    const creatureJson: CreatureInternal = {
      neurons: [{ type: "output", index: 1, bias: 0, squash: "Exponential" }],
      synapses: [{ from: 0, to: 1, weight: 1.0 }],
      input: 1,
      output: 1,
    };
    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([50]); // > 36, triggers JS clamp
    const jsOutput = creature.activate(input, false, true);
    const wasmOutput = creature.activate(input, false, false);

    assertArrayClose(wasmOutput, jsOutput, "Exponential clamp parity");
  },
});

// =============================================================================
// Test: activateAndTrace() with useJs parameter (Issue #1122)
// =============================================================================

Deno.test({
  name: "Creature WASM: activateAndTrace() accepts useJs parameter",
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

    // Issue #1122: activateAndTrace now uses WASM by default
    const jsOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      true, // useJs=true (force JS)
    );
    creature.clearState();
    const wasmOutput = creature.activateAndTrace(
      input,
      false,
      sparseConfig,
      false, // useJs=false (use WASM)
    );

    assertArrayClose(
      wasmOutput,
      jsOutput,
      "activateAndTrace outputs should match",
    );
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
// Test: Issue #1229 - No fallback; default requires WASM; useJs for verification
// =============================================================================

Deno.test({
  name:
    "Creature WASM: Throws for unsupported squash (MEAN); useJs works for verification",
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

    const input = new Float32Array([1.0, 2.0]);

    // Issue #1229: Default path requires WASM; no fallback - throws for MEAN.
    // Ensure env does not allow JS so we actually test the throw.
    const prev = Deno.env.get("NEAT_AI_USE_JS_ACTIVATION");
    Deno.env.delete("NEAT_AI_USE_JS_ACTIVATION");
    let threw = false;
    try {
      creature.activate(input, false, false);
    } catch (e) {
      threw = true;
      assert(
        (e as Error).message.includes("MEAN"),
        "Error should mention unsupported squash",
      );
    }
    assert(threw, "Default activate should throw for MEAN (no fallback)");
    if (prev !== undefined) Deno.env.set("NEAT_AI_USE_JS_ACTIVATION", prev);

    // useJs=true (verification only) still works
    const jsOutput = creature.activate(input, false, true);
    assertEquals(jsOutput.length, 1, "JS activation should produce one output");
    // MEAN squash: (1.0 + 2.0) / 2 + bias = 1.5 + 0.5 = 2.0
    assertAlmostEquals(jsOutput[0], 2.0, 1e-5);
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

    // First activation with WASM should compile
    const output1 = creature.activate(input1, false, false); // useJs=false (WASM)
    assert(output1.length === 1);

    // Second activation should use cached WASM activation
    const output2 = creature.activate(input2, false, false); // useJs=false (WASM)
    assert(output2.length === 1);

    // Results should still be correct
    const jsOutput1 = creature.activate(input1, false, true); // useJs=true
    const jsOutput2 = creature.activate(input2, false, true); // useJs=true

    assertArrayClose(output1, jsOutput1);
    assertArrayClose(output2, jsOutput2);
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

    // Activate with WASM to compile and cache
    const output1 = creature.activate(input, false, false); // useJs=false (WASM)

    // Clear state (simulates structural change)
    creature.clearState();

    // Should still work after clearState (will recompile if needed)
    const output2 = creature.activate(input, false, false); // useJs=false (WASM)

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
  name: "Creature WASM: Buffer reuse works with WASM default",
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

    // Activate with WASM - copy immediately (defensive)
    const output1 = new Float32Array(
      creature.activate(input1, false, false), // useJs=false (WASM)
    );
    const expected1 = creature.activate(input1, false, true); // useJs=true

    const output2 = new Float32Array(
      creature.activate(input2, false, false), // useJs=false (WASM)
    );
    const expected2 = creature.activate(input2, false, true); // useJs=true

    assertArrayClose(output1, expected1, "First output");
    assertArrayClose(output2, expected2, "Second output");
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

    const jsOutput = creature.activate(input, false, true); // useJs=true
    const wasmOutput = creature.activate(input, false, false); // useJs=false (WASM)

    assertEquals(jsOutput.length, 2, "JS output should have 2 values");
    assertEquals(wasmOutput.length, 2, "WASM output should have 2 values");
    assertArrayClose(wasmOutput, jsOutput, "Multi-output results should match");
  },
});

// =============================================================================
// Test: Constant neurons with WASM
// =============================================================================

Deno.test({
  name: "Creature WASM: Works with constant neurons",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "constant", index: 0, bias: 1.0 },
        { type: "hidden", index: 2, bias: 0, squash: "IDENTITY" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 2.0 },
        { from: 1, to: 2, weight: 1.0 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const input = new Float32Array([3.0]);

    const jsOutput = creature.activate(input, false, true); // useJs=true
    const wasmOutput = creature.activate(input, false, false); // useJs=false (WASM)

    assertArrayClose(
      wasmOutput,
      jsOutput,
      "Constant neuron results should match",
    );
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

      const jsOutput = creature.activate(input, false, true); // useJs=true
      const wasmOutput = creature.activate(input, false, false); // useJs=false (WASM)

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `${squash} should produce matching results`,
        1e-4, // Slightly larger tolerance for complex functions
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

    // Activate with WASM to compile and cache
    creature.activate(input, false, false); // useJs=false (WASM)

    // Dispose WASM resources
    creature.disposeWasm();

    // Should still work after dispose (will recompile on next WASM activation)
    const output = creature.activate(input, false, false); // useJs=false (WASM)
    assert(output.length === 1, "Should still produce output after dispose");
  },
});
