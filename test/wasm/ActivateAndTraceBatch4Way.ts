/**
 * WASM activate_and_trace_batch_4way() Unit Tests
 *
 * Issue #1212 - SIMD: Implement batch activate_and_trace for backpropagation
 *
 * These tests verify that the batch 4-way activate_and_trace method produces
 * identical results to calling activate_and_trace 4 times individually.
 * This ensures numerical parity so training convergence is unaffected.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../../src/wasm/mod.ts";

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
    `${
      message ?? ""
    }: Array lengths differ (actual=${actual.length}, expected=${expected.length})`,
  );
  for (let i = 0; i < actual.length; i++) {
    assertClose(actual[i], expected[i], `${message ?? ""}[${i}]`, tolerance);
  }
}

// Initialise WASM before tests
Deno.test({
  name: "WASM batch 4-way trace: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test({
  name:
    "WASM batch 4-way trace: ReLU network matches single-record activateAndTrace",
  fn() {
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

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([1.0, 2.0]),
      new Float32Array([0.5, -1.0]),
      new Float32Array([-2.0, 3.0]),
      new Float32Array([0.0, 0.0]),
    ];

    // Get single-record results
    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTrace(input);
    });

    // Get batch result
    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4Way(inputs);

    // Compare each record
    for (let i = 0; i < 4; i++) {
      const single = singleResults[i];
      const batch = batchResults[i];

      assertArrayClose(
        batch.outputs,
        single.outputs,
        `Record ${i} outputs`,
      );
      assertArrayClose(
        batch.activations,
        single.activations,
        `Record ${i} activations`,
      );
      assertArrayClose(
        batch.hintValues,
        single.hintValues,
        `Record ${i} hintValues`,
      );
      assertEquals(
        batch.traceEntries.length,
        single.traceEntries.length,
        `Record ${i} traceEntries length`,
      );
    }
  },
});

Deno.test({
  name: "WASM batch 4-way trace: TANH+LOGISTIC network matches single-record",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.0, squash: "TANH" },
        { type: "output", index: 3, bias: 0.5, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: -0.7 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([1.0, 0.5]),
      new Float32Array([-1.0, 2.0]),
      new Float32Array([0.3, -0.3]),
      new Float32Array([2.0, -1.0]),
    ];

    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTrace(input);
    });

    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4Way(inputs);

    for (let i = 0; i < 4; i++) {
      assertArrayClose(
        batchResults[i].outputs,
        singleResults[i].outputs,
        `Record ${i} outputs`,
      );
      assertArrayClose(
        batchResults[i].activations,
        singleResults[i].activations,
        `Record ${i} activations`,
      );
      assertArrayClose(
        batchResults[i].hintValues,
        singleResults[i].hintValues,
        `Record ${i} hintValues`,
      );
    }
  },
});

Deno.test({
  name: "WASM batch 4-way trace: MINIMUM aggregate matches single-record",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "output", index: 2, bias: 0.0, squash: "MINIMUM" },
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

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([3.0, 1.0]),
      new Float32Array([-1.0, 2.0]),
      new Float32Array([5.0, 5.0]),
      new Float32Array([0.0, -3.0]),
    ];

    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTrace(input);
    });

    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4Way(inputs);

    for (let i = 0; i < 4; i++) {
      assertArrayClose(
        batchResults[i].outputs,
        singleResults[i].outputs,
        `Record ${i} outputs`,
      );
      assertEquals(
        batchResults[i].traceEntries.length,
        singleResults[i].traceEntries.length,
        `Record ${i} traceEntries length`,
      );
      for (let j = 0; j < singleResults[i].traceEntries.length; j++) {
        assertEquals(
          batchResults[i].traceEntries[j].neuronRelativeIndex,
          singleResults[i].traceEntries[j].neuronRelativeIndex,
          `Record ${i} trace ${j} neuronRelativeIndex`,
        );
        assertClose(
          batchResults[i].traceEntries[j].traceInfo,
          singleResults[i].traceEntries[j].traceInfo,
          `Record ${i} trace ${j} traceInfo`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM batch 4-way trace: MAXIMUM aggregate matches single-record",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "output", index: 2, bias: 0.5, squash: "MAXIMUM" },
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

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([3.0, 1.0]),
      new Float32Array([-1.0, 2.0]),
      new Float32Array([5.0, 5.0]),
      new Float32Array([0.0, -3.0]),
    ];

    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTrace(input);
    });

    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4Way(inputs);

    for (let i = 0; i < 4; i++) {
      assertArrayClose(
        batchResults[i].outputs,
        singleResults[i].outputs,
        `Record ${i} outputs`,
      );
      assertEquals(
        batchResults[i].traceEntries.length,
        singleResults[i].traceEntries.length,
        `Record ${i} traceEntries length`,
      );
    }
  },
});

Deno.test({
  name: "WASM batch 4-way trace: Multi-layer network matches single-record",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 3, bias: 0.1, squash: "ReLU" },
        { type: "hidden", index: 4, bias: -0.1, squash: "TANH" },
        { type: "output", index: 5, bias: 0.0, squash: "IDENTITY" },
        { type: "output", index: 6, bias: 0.2, squash: "LOGISTIC" },
      ],
      synapses: [
        { from: 0, to: 3, weight: 0.5 },
        { from: 1, to: 3, weight: 0.3 },
        { from: 2, to: 3, weight: -0.2 },
        { from: 0, to: 4, weight: -0.4 },
        { from: 1, to: 4, weight: 0.6 },
        { from: 2, to: 4, weight: 0.1 },
        { from: 3, to: 5, weight: 1.0 },
        { from: 4, to: 5, weight: -0.5 },
        { from: 3, to: 6, weight: 0.7 },
        { from: 4, to: 6, weight: 0.3 },
      ],
      input: 3,
      output: 2,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([1.0, 2.0, 3.0]),
      new Float32Array([-1.0, 0.5, -0.5]),
      new Float32Array([0.0, 0.0, 0.0]),
      new Float32Array([2.5, -1.5, 0.8]),
    ];

    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTrace(input);
    });

    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4Way(inputs);

    for (let i = 0; i < 4; i++) {
      assertArrayClose(
        batchResults[i].outputs,
        singleResults[i].outputs,
        `Record ${i} outputs`,
      );
      assertArrayClose(
        batchResults[i].activations,
        singleResults[i].activations,
        `Record ${i} activations`,
      );
      assertArrayClose(
        batchResults[i].hintValues,
        singleResults[i].hintValues,
        `Record ${i} hintValues`,
      );
    }
  },
});

Deno.test({
  name:
    "WASM batch 4-way trace with feedback: Stateless reset matches single-record",
  fn() {
    const json: CreatureInternal = {
      neurons: [
        { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
        { type: "output", index: 3, bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: -0.3 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.fix();
    creature.clearState();

    const compiled = compileCreatureToWasm(creature);

    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([1.0, 0.5]),
      new Float32Array([2.0, 1.0]),
      new Float32Array([-1.0, 0.0]),
      new Float32Array([0.0, -1.0]),
    ];

    // Single-record with feedback=false
    const singleResults = inputs.map((input) => {
      const wasm = WasmCreatureActivation.create(compiled);
      assert(wasm, "Should create WASM activation");
      return wasm.activateAndTraceWithFeedback(input, false);
    });

    // Batch with feedback=false
    const batchWasm = WasmCreatureActivation.create(compiled);
    assert(batchWasm, "Should create WASM activation for batch");
    const batchResults = batchWasm.activateAndTraceBatch4WayWithFeedback(
      inputs,
      false,
    );

    for (let i = 0; i < 4; i++) {
      assertArrayClose(
        batchResults[i].outputs,
        singleResults[i].outputs,
        `Record ${i} outputs`,
      );
    }
  },
});
