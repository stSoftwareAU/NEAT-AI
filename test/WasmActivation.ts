/**
 * WASM Activation Unit Tests
 *
 * Issue #1116 - WASM prototype for creature activation
 *
 * These tests verify that the WASM activation produces the same results
 * as the JS-based activation for various creature configurations.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  WasmCreatureActivation,
  wasmSquash,
  wasmVersion,
} from "../src/wasm/mod.ts";

// Tolerance for floating point comparisons
// WASM uses f32, JS uses f64, so we need some tolerance
const TOLERANCE = 1e-5;

function assertClose(
  actual: number,
  expected: number,
  message?: string,
  tolerance: number = TOLERANCE,
): void {
  const diff = Math.abs(actual - expected);
  const msg = message
    ? `${message}: expected ${expected}, got ${actual} (diff: ${diff})`
    : `Expected ${expected}, got ${actual} (diff: ${diff})`;
  assert(diff < tolerance, msg);
}

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
    assertClose(actual[i], expected[i], `${message ?? ""}[${i}]`, tolerance);
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

Deno.test({
  name: "WASM Activation: Version",
  fn() {
    const version = wasmVersion();
    assertEquals(version, "0.1.0", "Version should be 0.1.0");
  },
});

Deno.test({
  name: "WASM Activation: Squash function mapping",
  fn() {
    // Verify squash name to type mapping
    assertEquals(getSquashType("IDENTITY"), SquashType.Identity);
    assertEquals(getSquashType("ReLU"), SquashType.Relu);
    assertEquals(getSquashType("SELU"), SquashType.Selu);
    assertEquals(getSquashType("TANH"), SquashType.Tanh);
    assertEquals(getSquashType("LOGISTIC"), SquashType.Logistic);
    assertEquals(getSquashType("Mish"), SquashType.Mish);
    assertEquals(getSquashType("GELU"), SquashType.Gelu);
    assertEquals(getSquashType(undefined), SquashType.Identity);
    assertEquals(getSquashType("UNKNOWN"), SquashType.Identity);
  },
});

Deno.test({
  name: "WASM Activation: Standalone squash functions",
  fn() {
    // ReLU
    assertEquals(wasmSquash(SquashType.Relu, 1.0), 1.0);
    assertEquals(wasmSquash(SquashType.Relu, -1.0), 0.0);
    assertEquals(wasmSquash(SquashType.Relu, 0.0), 0.0);

    // Tanh
    assertClose(wasmSquash(SquashType.Tanh, 0.0), 0.0);
    assertClose(wasmSquash(SquashType.Tanh, 1.0), Math.tanh(1.0));

    // Logistic
    assertClose(wasmSquash(SquashType.Logistic, 0.0), 0.5);
    assertClose(
      wasmSquash(SquashType.Logistic, 1.0),
      1 / (1 + Math.exp(-1.0)),
    );

    // Identity - use assertClose due to f32 precision
    assertClose(wasmSquash(SquashType.Identity, 42.0), 42.0);
    assertClose(wasmSquash(SquashType.Identity, -3.14), -3.14);

    // Step
    assertEquals(wasmSquash(SquashType.Step, 1.0), 1.0);
    assertEquals(wasmSquash(SquashType.Step, -1.0), 0.0);

    // Bipolar
    assertEquals(wasmSquash(SquashType.Bipolar, 1.0), 1.0);
    assertEquals(wasmSquash(SquashType.Bipolar, -1.0), -1.0);
  },
});

Deno.test({
  name: "WASM Activation: Simple ReLU network",
  fn() {
    // Create a simple creature with ReLU activation
    // Neuron layout: [input0, input1, hidden0, output0]
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

    // Compile and create WASM activation
    const compiled = compileCreatureToWasm(creature);
    assertEquals(compiled.numNeurons, 4);
    assertEquals(compiled.numInputs, 2);
    assertEquals(compiled.numOutputs, 1);
    assertEquals(compiled.numSynapses, 3);

    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    // Test with various inputs
    const testCases = [
      new Float32Array([1.0, 0.0]),
      new Float32Array([0.0, 1.0]),
      new Float32Array([1.0, 1.0]),
      new Float32Array([-1.0, -1.0]),
      new Float32Array([2.0, 0.5]),
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Network with multiple squash functions",
  fn() {
    // Create a creature with various squash functions
    // Neuron layout: [input0, input1, h-relu, h-tanh, h-logistic, output0]
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

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    const input = new Float32Array([0.5, -0.5]);
    const jsOutput = creature.activate(input, false);
    const wasmOutput = wasmActivation.activate(input);

    assertArrayClose(wasmOutput, jsOutput);

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Constant neurons",
  fn() {
    // Create a creature with a constant neuron
    // Neuron layout: [const-1, input0, hidden0, output0]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "constant", index: 0, bias: 1.0 },
        { type: "hidden", index: 2, bias: 0, squash: "IDENTITY" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 2.0 }, // constant * 2
        { from: 1, to: 2, weight: 1.0 }, // input * 1
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    const input = new Float32Array([3.0]);
    const jsOutput = creature.activate(input, false);
    const wasmOutput = wasmActivation.activate(input);

    // After fix(), neuron layout is: [input, constant, hidden, output]
    // Synapses: 0->2 (w=2), 1->2 (w=1), 2->3 (w=1)
    // hidden = 2.0 * input + 1.0 * constant = 2.0 * 3.0 + 1.0 * 1.0 = 7.0
    // output = 7.0 * 1.0 = 7.0
    assertClose(wasmOutput[0], 7.0);
    assertArrayClose(wasmOutput, jsOutput);

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Batch activation",
  fn() {
    // Create a simple network
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "output", index: 1, bias: 1.0, squash: "ReLU" },
      ],
      synapses: [
        { from: 0, to: 1, weight: 2.0 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    // Create batch inputs: 5 samples of 1 input each
    const batchInputs = new Float32Array([0.5, -1.0, 2.0, 0.0, -0.5]);
    const batchOutputs = wasmActivation.activateBatch(batchInputs, 1);

    assertEquals(batchOutputs.length, 5);

    // Verify each output matches individual activation
    for (let i = 0; i < 5; i++) {
      const input = new Float32Array([batchInputs[i]]);
      const jsOutput = creature.activate(input, false);
      assertClose(batchOutputs[i], jsOutput[0], `Sample ${i}`);
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Large traced creature (known limitation)",
  ignore: true, // Skip - traced.json uses deprecated functions (HYPOT, MEAN) not supported in WASM
  async fn() {
    // NOTE: This test is disabled because the traced.json creature uses
    // deprecated activation functions (HYPOT, MEAN) that are not supported
    // in WASM. Issue #1125 implemented support for the main aggregate
    // functions (IF, MINIMUM, MAXIMUM).
    //
    // The deprecated functions (HYPOT, MEAN) were intentionally not added
    // to WASM as production creatures should have evolved away from using
    // them. When the training data no longer includes creatures with these
    // deprecated functions, this test can be enabled.

    // Load the traced creature from test data
    const creatureJson = JSON.parse(
      await Deno.readTextFile("test/data/traced.json"),
    );
    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    // Test with random inputs
    for (let test = 0; test < 10; test++) {
      const input = new Float32Array(creature.input);
      for (let i = 0; i < creature.input; i++) {
        input[i] = Math.random() * 4 - 2;
      }

      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      // Use larger tolerance for complex network
      // f32 vs f64 precision differences accumulate through layers
      assertArrayClose(wasmOutput, jsOutput, `Test ${test}`, 1e-3);
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Input length validation",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "output", index: 2, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    // Wrong input length should throw
    let threw = false;
    try {
      wasmActivation.activate(new Float32Array([1.0])); // Only 1 input, needs 2
    } catch {
      threw = true;
    }
    assert(threw, "Should throw for wrong input length");

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Free and reuse prevention",
  fn() {
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "output", index: 1, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null);

    // Free should work
    wasmActivation.free();

    // Using after free should throw
    let threw = false;
    try {
      wasmActivation.activate(new Float32Array([1.0]));
    } catch {
      threw = true;
    }
    assert(threw, "Should throw when using freed activation");
  },
});

// Issue #1125 - WASM Migration Phase 0: Aggregate squash functions
// These tests verify that aggregate functions (IF, MINIMUM, MAXIMUM) work correctly in WASM

Deno.test({
  name: "WASM Activation: MINIMUM squash function",
  fn() {
    // Create a creature with MINIMUM activation
    // MINIMUM takes the minimum of all weighted input values + bias
    // Neuron layout: [input0, input1, minimum-hidden, output]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "MINIMUM" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 2.0 }, // input0 * 2.0
        { from: 1, to: 2, weight: 1.5 }, // input1 * 1.5
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    // Test with various inputs
    const testCases = [
      new Float32Array([1.0, 2.0]), // min(2.0, 3.0) + 0.5 = 2.5
      new Float32Array([3.0, 1.0]), // min(6.0, 1.5) + 0.5 = 2.0
      new Float32Array([-1.0, 2.0]), // min(-2.0, 3.0) + 0.5 = -1.5
      new Float32Array([0.0, 0.0]), // min(0, 0) + 0.5 = 0.5
      new Float32Array([-2.0, -1.0]), // min(-4.0, -1.5) + 0.5 = -3.5
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `MINIMUM Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: MAXIMUM squash function",
  fn() {
    // Create a creature with MAXIMUM activation
    // MAXIMUM takes the maximum of all weighted input values + bias
    // Neuron layout: [input0, input1, maximum-hidden, output]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: -0.5, squash: "MAXIMUM" },
        { type: "output", index: 3, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 2.0 }, // input0 * 2.0
        { from: 1, to: 2, weight: 1.5 }, // input1 * 1.5
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    // Test with various inputs
    const testCases = [
      new Float32Array([1.0, 2.0]), // max(2.0, 3.0) - 0.5 = 2.5
      new Float32Array([3.0, 1.0]), // max(6.0, 1.5) - 0.5 = 5.5
      new Float32Array([-1.0, 2.0]), // max(-2.0, 3.0) - 0.5 = 2.5
      new Float32Array([0.0, 0.0]), // max(0, 0) - 0.5 = -0.5
      new Float32Array([-2.0, -1.0]), // max(-4.0, -1.5) - 0.5 = -2.0
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `MAXIMUM Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: IF squash function",
  fn() {
    // Create a creature with IF activation
    // IF uses three types of synapses: condition, positive, negative
    // if (condition > 0) { output = positive + bias } else { output = negative + bias }
    // Neuron layout: [input0, input1, input2, if-hidden, output]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 3, bias: 1.0, squash: "IF" },
        { type: "output", index: 4, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0, type: "condition" }, // condition input
        { from: 1, to: 3, weight: 2.0, type: "positive" }, // positive branch
        { from: 2, to: 3, weight: 3.0, type: "negative" }, // negative branch
        { from: 3, to: 4, weight: 1.0 },
      ],
      input: 3,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    // Test with various inputs
    // [condition, positive, negative]
    const testCases = [
      // condition > 0: use positive branch
      new Float32Array([1.0, 2.0, 5.0]), // 1.0 > 0, so: 2.0 * 2.0 + 1.0 = 5.0
      new Float32Array([0.5, 3.0, 1.0]), // 0.5 > 0, so: 3.0 * 2.0 + 1.0 = 7.0
      // condition <= 0: use negative branch
      new Float32Array([-1.0, 2.0, 5.0]), // -1.0 <= 0, so: 5.0 * 3.0 + 1.0 = 16.0
      new Float32Array([0.0, 3.0, 1.0]), // 0.0 <= 0, so: 1.0 * 3.0 + 1.0 = 4.0
      new Float32Array([-0.5, 0.0, 2.0]), // -0.5 <= 0, so: 2.0 * 3.0 + 1.0 = 7.0
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `IF Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: IF with multiple condition inputs",
  fn() {
    // Test IF with multiple condition inputs (they get summed)
    // Neuron layout: [input0, input1, input2, input3, if-hidden, output]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 4, bias: 0, squash: "IF" },
        { type: "output", index: 5, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 4, weight: 1.0, type: "condition" }, // condition 1
        { from: 1, to: 4, weight: 1.0, type: "condition" }, // condition 2
        { from: 2, to: 4, weight: 1.0, type: "positive" }, // positive branch
        { from: 3, to: 4, weight: 1.0, type: "negative" }, // negative branch
        { from: 4, to: 5, weight: 1.0 },
      ],
      input: 4,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    // Test with various inputs [cond1, cond2, positive, negative]
    const testCases = [
      // Sum of conditions > 0: use positive
      new Float32Array([1.0, 1.0, 5.0, 2.0]), // (1+1) > 0, so: 5.0
      new Float32Array([-0.5, 1.0, 3.0, 1.0]), // (-0.5+1) > 0, so: 3.0
      // Sum of conditions <= 0: use negative
      new Float32Array([-1.0, -1.0, 5.0, 2.0]), // (-1-1) <= 0, so: 2.0
      new Float32Array([0.5, -0.5, 3.0, 1.0]), // (0.5-0.5) <= 0, so: 1.0
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `IF multiple conditions Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Mixed aggregate and standard squash functions",
  fn() {
    // Create a more complex creature that uses both standard and aggregate functions
    // Neuron layout: [input0, input1, relu-hidden, minimum-hidden, output]
    const creatureJson: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0, squash: "ReLU" },
        { type: "hidden", index: 3, bias: 0, squash: "MINIMUM" },
        { type: "output", index: 4, bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -1.0 },
        { from: 0, to: 3, weight: 1.0 },
        { from: 2, to: 3, weight: 1.0 },
        { from: 3, to: 4, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(creatureJson);
    creature.fix();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation !== null, "WASM activation should be created");

    const testCases = [
      new Float32Array([2.0, 1.0]), // relu(2-1)=1, min(2, 1)=1
      new Float32Array([1.0, 3.0]), // relu(1-3)=0, min(1, 0)=0
      new Float32Array([-1.0, 0.0]), // relu(-1-0)=0, min(-1, 0)=-1
    ];

    for (const input of testCases) {
      const jsOutput = creature.activate(input, false);
      const wasmOutput = wasmActivation.activate(input);

      assertArrayClose(
        wasmOutput,
        jsOutput,
        `Mixed network Input: [${input.join(", ")}]`,
        TOLERANCE,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM Activation: Squash type mapping for aggregate functions",
  fn() {
    // Verify aggregate function squash name to type mapping
    assertEquals(getSquashType("MINIMUM"), SquashType.Minimum);
    assertEquals(getSquashType("MAXIMUM"), SquashType.Maximum);
    assertEquals(getSquashType("IF"), SquashType.If);
  },
});
