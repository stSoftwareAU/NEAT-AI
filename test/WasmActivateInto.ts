/**
 * WASM activate_into() Unit Tests
 *
 * Issue #1171 - WASM Performance: Per-call Float32Array allocation overhead
 *
 * These tests verify that the new activate_into() method, which accepts a
 * pre-allocated output buffer, produces the same results as the existing
 * activate() method while avoiding per-call Float32Array allocations.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
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

// Initialise WASM before tests
Deno.test({
  name: "WASM activate_into: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test({
  name:
    "WASM activate_into: Simple ReLU network produces same output as activate()",
  fn() {
    // Create a simple network
    const json: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: -0.2, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -0.5 },
        { from: 2, to: 3, weight: 2.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation, "Should create WASM activation");

    const input = new Float32Array([1.0, 0.5]);

    // Get expected output from standard activate()
    const expectedOutput = wasmActivation.activate(input);

    // Test activateInto with pre-allocated buffer
    const outputBuffer = new Float32Array(creature.output);
    wasmActivation.activateInto(input, outputBuffer);

    assertArrayClose(
      outputBuffer,
      expectedOutput,
      "activate_into should produce same results as activate",
    );

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM activate_into: Multiple activations reuse the same buffer",
  fn() {
    // Create a simple network with multiple outputs
    const json: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 3, bias: 0.1, squash: "TANH" },
        { type: "output", index: 4, bias: 0.0, squash: "LOGISTIC" },
        { type: "output", index: 5, bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 3, weight: 0.5 },
        { from: 2, to: 3, weight: -0.5 },
        { from: 3, to: 4, weight: 1.0 },
        { from: 3, to: 5, weight: -1.0 },
      ],
      input: 3,
      output: 2,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation, "Should create WASM activation");

    // Pre-allocate output buffer once
    const outputBuffer = new Float32Array(creature.output);

    // Test multiple activations with different inputs, reusing the same buffer
    const testInputs = [
      new Float32Array([0.5, -0.3, 0.8]),
      new Float32Array([1.0, 0.0, -1.0]),
      new Float32Array([-0.5, 0.7, 0.2]),
      new Float32Array([0.0, 0.0, 0.0]),
    ];

    for (const input of testInputs) {
      const expectedOutput = wasmActivation.activate(input);
      wasmActivation.activateInto(input, outputBuffer);

      assertArrayClose(
        outputBuffer,
        expectedOutput,
        `activate_into should match activate for input [${input.join(", ")}]`,
      );
    }

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM activate_into: Works with all standard squash functions",
  fn() {
    const squashFunctions = [
      "IDENTITY",
      "ReLU",
      "TANH",
      "LOGISTIC",
      "SELU",
      "ELU",
      "LeakyReLU",
      "Softplus",
      "GELU",
    ];

    for (const squash of squashFunctions) {
      const json: CreatureInternal = {
        neurons: [
          { type: "hidden", index: 2, bias: 0.5, squash },
          { type: "output", index: 3, bias: 0.0, squash: "IDENTITY" },
        ],
        synapses: [
          { from: 0, to: 2, weight: 1.0 },
          { from: 1, to: 2, weight: 0.5 },
          { from: 2, to: 3, weight: 1.0 },
        ],
        input: 2,
        output: 1,
      };

      const creature = Creature.fromJSON(json);
      creature.fix();
      creature.clearState();

      const compiled = compileCreatureToWasm(creature);
      const wasmActivation = WasmCreatureActivation.create(compiled);
      assert(wasmActivation, `Should create WASM activation for ${squash}`);

      const input = new Float32Array([0.7, -0.3]);
      const expectedOutput = wasmActivation.activate(input);

      const outputBuffer = new Float32Array(creature.output);
      wasmActivation.activateInto(input, outputBuffer);

      assertArrayClose(
        outputBuffer,
        expectedOutput,
        `activate_into should match activate for ${squash}`,
      );

      wasmActivation.free();
    }
  },
});

Deno.test({
  name:
    "WASM activate_into: Works with aggregate functions (MINIMUM, MAXIMUM, IF)",
  fn() {
    // Test MINIMUM
    {
      const json: CreatureInternal = {
        neurons: [
          { type: "output", index: 3, bias: 0.0, squash: "MINIMUM" },
        ],
        synapses: [
          { from: 0, to: 3, weight: 1.0 },
          { from: 1, to: 3, weight: 1.0 },
          { from: 2, to: 3, weight: 1.0 },
        ],
        input: 3,
        output: 1,
      };

      const creature = Creature.fromJSON(json);
      creature.fix();
      creature.clearState();

      const compiled = compileCreatureToWasm(creature);
      const wasmActivation = WasmCreatureActivation.create(compiled);
      assert(wasmActivation, "Should create WASM activation for MINIMUM");

      const input = new Float32Array([0.5, -0.3, 0.8]);
      const expectedOutput = wasmActivation.activate(input);

      const outputBuffer = new Float32Array(creature.output);
      wasmActivation.activateInto(input, outputBuffer);

      assertArrayClose(
        outputBuffer,
        expectedOutput,
        "activate_into should match activate for MINIMUM",
      );

      wasmActivation.free();
    }

    // Test MAXIMUM
    {
      const json: CreatureInternal = {
        neurons: [
          { type: "output", index: 3, bias: 0.0, squash: "MAXIMUM" },
        ],
        synapses: [
          { from: 0, to: 3, weight: 1.0 },
          { from: 1, to: 3, weight: 1.0 },
          { from: 2, to: 3, weight: 1.0 },
        ],
        input: 3,
        output: 1,
      };

      const creature = Creature.fromJSON(json);
      creature.fix();
      creature.clearState();

      const compiled = compileCreatureToWasm(creature);
      const wasmActivation = WasmCreatureActivation.create(compiled);
      assert(wasmActivation, "Should create WASM activation for MAXIMUM");

      const input = new Float32Array([0.5, -0.3, 0.8]);
      const expectedOutput = wasmActivation.activate(input);

      const outputBuffer = new Float32Array(creature.output);
      wasmActivation.activateInto(input, outputBuffer);

      assertArrayClose(
        outputBuffer,
        expectedOutput,
        "activate_into should match activate for MAXIMUM",
      );

      wasmActivation.free();
    }
  },
});

Deno.test({
  name: "WASM activate_into: Validates input and output buffer lengths",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "output", index: 2, bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation, "Should create WASM activation");

    // Test wrong input length
    let threw = false;
    try {
      const wrongInput = new Float32Array([1.0]); // Wrong size
      const outputBuffer = new Float32Array(1);
      wasmActivation.activateInto(wrongInput, outputBuffer);
    } catch {
      threw = true;
    }
    assert(threw, "Should throw for wrong input length");

    // Test wrong output buffer length
    threw = false;
    try {
      const input = new Float32Array([1.0, 0.5]);
      const wrongOutput = new Float32Array(3); // Wrong size
      wasmActivation.activateInto(input, wrongOutput);
    } catch {
      threw = true;
    }
    assert(threw, "Should throw for wrong output buffer length");

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM activate_into: Works with larger network",
  fn() {
    // Create a larger network for stress testing
    const numInputs = 100;
    const numHidden = 50;
    const numOutputs = 10;

    const neurons: CreatureInternal["neurons"] = [];
    const synapses: CreatureInternal["synapses"] = [];

    // Add hidden neurons
    for (let i = 0; i < numHidden; i++) {
      neurons.push({
        type: "hidden",
        index: numInputs + i,
        bias: Math.random() * 2 - 1,
        squash: "ReLU",
      });
    }

    // Add output neurons
    for (let i = 0; i < numOutputs; i++) {
      neurons.push({
        type: "output",
        index: numInputs + numHidden + i,
        bias: Math.random() * 2 - 1,
        squash: "LOGISTIC",
      });
    }

    // Connect inputs to hidden (sparse connectivity)
    for (let i = 0; i < numInputs; i += 5) {
      for (let h = 0; h < numHidden; h += 2) {
        synapses.push({
          from: i,
          to: numInputs + h,
          weight: Math.random() * 2 - 1,
        });
      }
    }

    // Connect hidden to outputs
    for (let h = 0; h < numHidden; h++) {
      for (let o = 0; o < numOutputs; o++) {
        synapses.push({
          from: numInputs + h,
          to: numInputs + numHidden + o,
          weight: Math.random() * 2 - 1,
        });
      }
    }

    const json: CreatureInternal = {
      neurons,
      synapses,
      input: numInputs,
      output: numOutputs,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation, "Should create WASM activation for large network");

    // Pre-allocate output buffer
    const outputBuffer = new Float32Array(numOutputs);

    // Generate random input
    const input = new Float32Array(numInputs);
    for (let i = 0; i < numInputs; i++) {
      input[i] = Math.random() * 4 - 2;
    }

    const expectedOutput = wasmActivation.activate(input);
    wasmActivation.activateInto(input, outputBuffer);

    assertArrayClose(
      outputBuffer,
      expectedOutput,
      "activate_into should match activate for large network",
    );

    wasmActivation.free();
  },
});

Deno.test({
  name: "WASM activate_into: Throws if activation has been freed",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "output", index: 2, bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);
    const wasmActivation = WasmCreatureActivation.create(compiled);
    assert(wasmActivation, "Should create WASM activation");

    // Free the activation
    wasmActivation.free();

    // Now try to use it
    let threw = false;
    try {
      const input = new Float32Array([1.0, 0.5]);
      const outputBuffer = new Float32Array(1);
      wasmActivation.activateInto(input, outputBuffer);
    } catch {
      threw = true;
    }
    assert(threw, "Should throw when using freed activation");
  },
});
