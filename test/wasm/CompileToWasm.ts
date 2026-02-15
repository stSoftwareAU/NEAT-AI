/**
 * CompileToWasm Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. Correct binary layout (header, neuron data, synapse data)
 * 2. Neuron count and bias encoding
 * 3. Synapse encoding including synapse types
 * 4. Compiled creature statistics
 * 5. Handling of different creature topologies
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  compileCreatureToWasm,
  getCompiledCreatureStats,
  SynapseTypeCode,
} from "../../src/wasm/CompileToWasm.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

/**
 * Create a simple creature from JSON for controlled testing.
 */
function makeCreature(json: CreatureExport): Creature {
  return Creature.fromJSON(json);
}

// ---------------------------------------------------------------------------
// Binary layout tests
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: header encodes neuron and input counts correctly", () => {
  const creature = makeCreature({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -0.3, fromUUID: "input-1", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // Header: u32 num_neurons, u32 num_inputs (both little-endian)
  const numNeurons = view.getUint32(0, true);
  const numInputs = view.getUint32(4, true);

  assertEquals(numNeurons, 3, "Should have 3 neurons (2 input + 1 output)");
  assertEquals(numInputs, 2, "Should have 2 inputs");
  assertEquals(compiled.numNeurons, 3);
  assertEquals(compiled.numInputs, 2);
  assertEquals(compiled.numOutputs, 1);

  creature.dispose();
});

Deno.test("CompileToWasm: bias is encoded as little-endian f64", () => {
  const biasValue = 0.75;
  const creature = makeCreature({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: biasValue, squash: "TANH" },
    ],
    synapses: [
      { weight: 1.0, fromUUID: "input-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // After 8-byte header, first neuron's bias is at offset 8
  const encodedBias = view.getFloat64(8, true);
  assertEquals(encodedBias, biasValue, "Bias should be encoded correctly");

  creature.dispose();
});

Deno.test("CompileToWasm: zero bias is encoded as zero", () => {
  const creature = makeCreature({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 1.0, fromUUID: "input-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  const encodedBias = view.getFloat64(8, true);
  assertEquals(encodedBias, 0, "Zero bias should be encoded as 0");

  creature.dispose();
});

Deno.test("CompileToWasm: squash type is encoded correctly", () => {
  const creature = makeCreature({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 1.0, fromUUID: "input-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // Squash type is at offset 8 (header) + 8 (bias) = 16
  const squashType = view.getUint8(16);
  // TANH = SquashType.Tanh = 7
  assertEquals(squashType, 7, "TANH should be encoded as squash type 7");

  creature.dispose();
});

Deno.test("CompileToWasm: synapse count is encoded as u16", () => {
  const creature = makeCreature({
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 0.1, fromUUID: "input-0", toUUID: "output-0" },
      { weight: 0.2, fromUUID: "input-1", toUUID: "output-0" },
      { weight: 0.3, fromUUID: "input-2", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // Synapse count: offset 8 (header) + 8 (bias) + 1 (squash) + 1 (constant) = 18
  const numSynapses = view.getUint16(18, true);
  assertEquals(numSynapses, 3, "Should encode 3 synapses");
  assertEquals(compiled.numSynapses, 3);

  creature.dispose();
});

Deno.test("CompileToWasm: synapse from_index and weight are encoded correctly", () => {
  const creature = makeCreature({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 0.42, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -0.99, fromUUID: "input-1", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // First synapse starts at offset 20:
  //   8 (header) + 12 (neuron: 8 bias + 1 squash + 1 constant + 2 synapse_count) = 20
  const synapse1From = view.getUint16(20, true);
  const synapse1Type = view.getUint8(22);
  const synapse1Weight = view.getFloat64(24, true);

  assertEquals(synapse1From, 0, "First synapse from_index should be 0");
  assertEquals(
    synapse1Type,
    SynapseTypeCode.Standard,
    "Default synapse type should be Standard",
  );
  assertEquals(synapse1Weight, 0.42, "First synapse weight should be 0.42");

  // Second synapse starts at offset 32 (20 + 12)
  const synapse2From = view.getUint16(32, true);
  const synapse2Weight = view.getFloat64(36, true);

  assertEquals(synapse2From, 1, "Second synapse from_index should be 1");
  assertEquals(synapse2Weight, -0.99, "Second synapse weight should be -0.99");

  creature.dispose();
});

Deno.test("CompileToWasm: synapse types are encoded correctly", () => {
  const creature = makeCreature({
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IF" },
    ],
    synapses: [
      {
        weight: 1.0,
        fromUUID: "input-0",
        toUUID: "output-0",
        type: "condition",
      },
      {
        weight: 1.0,
        fromUUID: "input-1",
        toUUID: "output-0",
        type: "positive",
      },
      {
        weight: 1.0,
        fromUUID: "input-2",
        toUUID: "output-0",
        type: "negative",
      },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // Synapses start at offset 20, sorted by from_index
  // Synapse 0 (from input-0): type = condition
  const type0 = view.getUint8(22);
  assertEquals(
    type0,
    SynapseTypeCode.Condition,
    "First synapse should be condition type",
  );

  // Synapse 1 (from input-1): type = positive
  const type1 = view.getUint8(34);
  assertEquals(
    type1,
    SynapseTypeCode.Positive,
    "Second synapse should be positive type",
  );

  // Synapse 2 (from input-2): type = negative
  const type2 = view.getUint8(46);
  assertEquals(
    type2,
    SynapseTypeCode.Negative,
    "Third synapse should be negative type",
  );

  creature.dispose();
});

// ---------------------------------------------------------------------------
// Total binary size tests
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: total binary size matches expected layout", () => {
  const creature = makeCreature({
    input: 2,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-1", bias: -0.2, squash: "RELU" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "output-0" },
      { weight: 0.3, fromUUID: "input-1", toUUID: "output-0" },
      { weight: -0.4, fromUUID: "input-0", toUUID: "output-1" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);

  // Expected size:
  // Header: 8 bytes
  // 2 non-input neurons × 12 bytes = 24 bytes
  // 3 synapses × 12 bytes = 36 bytes
  // Total = 8 + 24 + 36 = 68 bytes
  const expectedSize = 8 + (2 * 12) + (3 * 12);
  assertEquals(compiled.data.length, expectedSize, "Binary size should match");

  creature.dispose();
});

// ---------------------------------------------------------------------------
// Hidden neuron tests
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: hidden neurons are compiled correctly", () => {
  const creature = makeCreature({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0.3, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: -0.1, squash: "LOGISTIC" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.2, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 0.8, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);

  assertEquals(compiled.numNeurons, 4, "Should have 4 neurons total");
  assertEquals(compiled.numInputs, 2, "Should have 2 inputs");
  assertEquals(compiled.numOutputs, 1, "Should have 1 output");
  assertEquals(compiled.numSynapses, 3, "Should have 3 synapses total");

  // Verify the hidden neuron bias is at offset 8
  const view = new DataView(compiled.data.buffer);
  const hiddenBias = view.getFloat64(8, true);
  assertEquals(hiddenBias, 0.3, "Hidden neuron bias should be 0.3");

  creature.dispose();
});

// ---------------------------------------------------------------------------
// Constant neuron test
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: constant neuron is_constant flag set to 1", () => {
  const creature = makeCreature({
    input: 1,
    output: 1,
    neurons: [
      // Constant neurons must not have a squash function
      { type: "constant", uuid: "constant-0", bias: 1.0 },
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 1.0, fromUUID: "input-0", toUUID: "output-0" },
      { weight: 0.5, fromUUID: "constant-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const view = new DataView(compiled.data.buffer);

  // First non-input neuron (constant-0) is_constant flag at offset 8 + 8 + 1 = 17
  const isConstant = view.getUint8(17);
  assertEquals(isConstant, 1, "Constant neuron should have is_constant = 1");

  // Second non-input neuron (output-0) is_constant flag
  // Skip first neuron: 12 bytes neuron header + its synapses
  // constant-0 has 0 synapses, so next neuron at offset 8 + 12 = 20
  // Output neuron is_constant at 20 + 8 + 1 = 29
  const isConstantOutput = view.getUint8(29);
  assertEquals(
    isConstantOutput,
    0,
    "Output neuron should have is_constant = 0",
  );

  creature.dispose();
});

// ---------------------------------------------------------------------------
// Statistics tests
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: getCompiledCreatureStats returns correct summary", () => {
  const creature = makeCreature({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "TANH" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 0.3, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 0.8, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);
  const stats = getCompiledCreatureStats(compiled);

  assertStringIncludes(stats, "4 neurons", "Should mention 4 total neurons");
  assertStringIncludes(stats, "2 input", "Should mention 2 inputs");
  assertStringIncludes(stats, "1 hidden", "Should mention 1 hidden");
  assertStringIncludes(stats, "1 output", "Should mention 1 output");
  assertStringIncludes(stats, "3 synapses", "Should mention 3 synapses");

  creature.dispose();
});

// ---------------------------------------------------------------------------
// Minimal creature test
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: minimal creature with no hidden neurons compiles", () => {
  const creature = new Creature(1, 1);
  creature.fix();

  const compiled = compileCreatureToWasm(creature);

  assertExists(compiled.data, "Compiled data should exist");
  assert(compiled.data.length > 0, "Compiled data should be non-empty");
  assertEquals(compiled.numInputs, 1);
  assertEquals(compiled.numOutputs, 1);
  assertEquals(
    compiled.numNeurons,
    2,
    "Should have 2 neurons (1 input + 1 output)",
  );

  creature.dispose();
});

// ---------------------------------------------------------------------------
// SynapseTypeCode enum test
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: SynapseTypeCode values match documented format", () => {
  assertEquals(SynapseTypeCode.Standard, 0);
  assertEquals(SynapseTypeCode.Condition, 1);
  assertEquals(SynapseTypeCode.Negative, 2);
  assertEquals(SynapseTypeCode.Positive, 3);
});

// ---------------------------------------------------------------------------
// Multiple non-input neurons test
// ---------------------------------------------------------------------------

Deno.test("CompileToWasm: multiple hidden neurons produce correct synapse totals", () => {
  const creature = makeCreature({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "h1", bias: 0.2, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: 0.3, squash: "LOGISTIC" },
    ],
    synapses: [
      { weight: 0.1, fromUUID: "input-0", toUUID: "h0" },
      { weight: 0.2, fromUUID: "input-1", toUUID: "h0" },
      { weight: 0.3, fromUUID: "input-0", toUUID: "h1" },
      { weight: 0.4, fromUUID: "input-1", toUUID: "h1" },
      { weight: 0.5, fromUUID: "h0", toUUID: "output-0" },
      { weight: 0.6, fromUUID: "h1", toUUID: "output-0" },
    ],
  });

  const compiled = compileCreatureToWasm(creature);

  assertEquals(compiled.numNeurons, 5, "2 inputs + 2 hidden + 1 output");
  assertEquals(compiled.numSynapses, 6, "6 total synapses");

  // Expected binary size:
  // Header: 8 bytes
  // 3 non-input neurons × 12 = 36 bytes
  // 6 synapses × 12 = 72 bytes
  // Total = 116 bytes
  assertEquals(compiled.data.length, 8 + 36 + 72);

  creature.dispose();
});
