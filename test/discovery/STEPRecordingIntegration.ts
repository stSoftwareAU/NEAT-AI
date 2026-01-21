/**
 * Integration tests for STEP neuron error recording during discovery.
 *
 * These tests verify that the Neuron.record() flow produces correct
 * DiscoverRecord.errors values for STEP neurons, which is critical
 * for discovery to find successful candidates.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { BIPOLAR } from "../../src/methods/activations/types/BIPOLAR.ts";
import { STEP } from "../../src/methods/activations/types/STEP.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Get the project root directory for WASM module path
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

// =============================================================================
// Basic Recording Tests
// =============================================================================

Deno.test("STEP recording: errors stored as numeric arrays", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "step-hidden",
        type: "hidden",
        squash: STEP.NAME,
        bias: 0,
      },
      {
        uuid: "output-0",
        type: "output",
        squash: "IDENTITY",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "step-hidden", weight: 1 },
      { fromUUID: "step-hidden", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Activate with positive input -> STEP outputs 1
  const input = new Float32Array([0.5]);
  creature.activate(input);

  // Request different expected output to generate error
  const expected = new Float32Array([0]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("step-hidden");
  assert(record, "expected a discovery record for step-hidden");

  const { errors } = record;
  assert(Array.isArray(errors), "errors should be stored as an array");

  for (const value of errors) {
    assertEquals(typeof value, "number", "each error should be a number");
    assert(Number.isFinite(value), "each error should be finite");
  }
});

// =============================================================================
// Magnitude Verification Tests
// =============================================================================

Deno.test("STEP recording: error magnitude when crossing from 0 to 1", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input -5 -> STEP outputs 0 (since -5 + 0 bias = -5, which is <= 0)
  const input = new Float32Array([-5]);
  creature.activate(input);

  // Request output of 1 -> need to cross threshold
  // currentValue = -5, target = 1
  // Expected error = 1 - (-5) = 6
  const expected = new Float32Array([1]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  // Verify activation was recorded correctly
  assertAlmostEquals(record.activation, 0, 1e-10, "activation should be 0");

  // Verify error magnitude
  assert(record.errors.length > 0, "should have at least one error");
  assertAlmostEquals(
    record.errors[0],
    6,
    1e-6,
    "error should be 6 (1 - (-5))",
  );
});

Deno.test("STEP recording: error magnitude when crossing from 1 to 0", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input 5 -> STEP outputs 1 (since 5 + 0 bias = 5, which is > 0)
  const input = new Float32Array([5]);
  creature.activate(input);

  // Request output of 0 -> need to cross threshold
  // currentValue = 5, target = 0
  // Expected error = 0 - 5 = -5
  const expected = new Float32Array([0]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  // Verify activation was recorded correctly
  assertAlmostEquals(record.activation, 1, 1e-10, "activation should be 1");

  // Verify error magnitude
  assert(record.errors.length > 0, "should have at least one error");
  assertAlmostEquals(
    record.errors[0],
    -5,
    1e-6,
    "error should be -5 (0 - 5)",
  );
});

// =============================================================================
// Already Correct Tests - Error should be 0
// =============================================================================

Deno.test("STEP recording: zero error when already on correct side (positive)", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input 5 -> STEP outputs 1
  const input = new Float32Array([5]);
  creature.activate(input);

  // Request output of 1 -> already correct
  const expected = new Float32Array([1]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  // Verify activation was recorded correctly
  assertAlmostEquals(record.activation, 1, 1e-10, "activation should be 1");

  // Error should be 0 because we're already at target
  assert(record.errors.length > 0, "should have at least one error entry");
  assertAlmostEquals(
    record.errors[0],
    0,
    1e-6,
    "error should be 0 when already at target",
  );
});

Deno.test("STEP recording: zero error when already on correct side (negative)", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input -5 -> STEP outputs 0
  const input = new Float32Array([-5]);
  creature.activate(input);

  // Request output of 0 -> already correct
  const expected = new Float32Array([0]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  // Verify activation was recorded correctly
  assertAlmostEquals(record.activation, 0, 1e-10, "activation should be 0");

  // Error should be 0 because we're already at target
  assert(record.errors.length > 0, "should have at least one error entry");
  assertAlmostEquals(
    record.errors[0],
    0,
    1e-6,
    "error should be 0 when already at target",
  );
});

// =============================================================================
// Hidden Neuron Recording Tests
// =============================================================================

Deno.test("STEP recording: hidden neuron receives propagated error", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "step-hidden",
        type: "hidden",
        squash: STEP.NAME,
        bias: 0,
      },
      {
        uuid: "output-0",
        type: "output",
        squash: "IDENTITY",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "step-hidden", weight: 1 },
      { fromUUID: "step-hidden", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input 0.5 -> STEP outputs 1, IDENTITY outputs 1
  const input = new Float32Array([0.5]);
  creature.activate(input);

  // Request output of 0 -> error propagates back to hidden
  const expected = new Float32Array([0]);
  const discoverMap = creature.record(expected);

  // Verify hidden neuron has a record
  const hiddenRecord = discoverMap.get("step-hidden");
  assert(hiddenRecord, "expected a discovery record for step-hidden");

  // Verify errors were recorded
  assert(hiddenRecord.errors.length > 0, "hidden neuron should have errors");
  assert(
    Number.isFinite(hiddenRecord.errors[0]),
    "hidden neuron error should be finite",
  );
});

// =============================================================================
// Threshold Edge Cases
// =============================================================================

Deno.test("STEP recording: at threshold (x=0)", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input 0 -> STEP outputs 0 (since 0 is NOT > 0)
  const input = new Float32Array([0]);
  creature.activate(input);

  // Request output of 1 -> need to cross
  // currentValue = 0, target = 1
  // Expected error = 1 - 0 = 1
  const expected = new Float32Array([1]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  assertAlmostEquals(record.activation, 0, 1e-10, "activation should be 0");
  assert(record.errors.length > 0, "should have at least one error");
  assertAlmostEquals(
    record.errors[0],
    1,
    1e-6,
    "error at threshold wanting 1 should be 1",
  );
});

// =============================================================================
// Extreme Value Tests (Clamped via calculateError)
// =============================================================================

Deno.test("STEP recording: extreme values are clamped (prevents exploding discovery errors)", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Regression: extreme values should not explode recorded error statistics.
  //
  // Input -1000 -> STEP outputs 0
  // Request output of 1 -> raw value-space error = 1 - (-1000) = 1001
  // With activation.calculateError() semantics, this must be clamped to +100.
  const input = new Float32Array([-1000]);
  creature.activate(input);

  const expected = new Float32Array([1]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  assert(record.errors.length > 0, "should have at least one error");
  assertAlmostEquals(
    record.errors[0],
    100,
    1e-6,
    "recording clamps extreme STEP value errors to +100",
  );

  // Verify error is finite and has correct sign
  assert(Number.isFinite(record.errors[0]), "error should be finite");
  assert(record.errors[0] > 0, "error should be positive (pushing toward 1)");
});

// =============================================================================
// BIPOLAR Clamp Regression
// =============================================================================

Deno.test("BIPOLAR recording: extreme values are clamped (prevents exploding discovery errors)", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: BIPOLAR.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Input +1e10 -> BIPOLAR outputs +1
  // Request output -1 -> raw value-space error ≈ -1 - 1e10
  // With activation.calculateError() semantics, this must be clamped to -100.
  const input = new Float32Array([1e10]);
  creature.activate(input);

  const expected = new Float32Array([-1]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  assert(record.errors.length > 0, "should have at least one error");
  assertAlmostEquals(
    record.errors[0],
    -100,
    1e-6,
    "recording clamps extreme BIPOLAR value errors to -100",
  );
  assert(Number.isFinite(record.errors[0]), "error should be finite");
  assert(record.errors[0] < 0, "error should be negative (pushing toward -1)");
});

// =============================================================================
// Multiple Samples Accumulation Test
// =============================================================================

Deno.test("STEP recording: consistent errors across multiple activations", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: STEP.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Test multiple input/output combinations
  const testCases = [
    { input: -5, expected: 1, expectedError: 6 },
    { input: 5, expected: 0, expectedError: -5 },
    { input: 0, expected: 1, expectedError: 1 },
  ];

  for (const tc of testCases) {
    const input = new Float32Array([tc.input]);
    creature.activate(input);

    const expected = new Float32Array([tc.expected]);
    const discoverMap = creature.record(expected);

    const record = discoverMap.get("output-0");
    assert(record, `expected a discovery record for input=${tc.input}`);

    assert(record.errors.length > 0, "should have at least one error");
    assertAlmostEquals(
      record.errors[0],
      tc.expectedError,
      1e-6,
      `error for input=${tc.input}, expected=${tc.expected} should be ${tc.expectedError}`,
    );
  }
});
