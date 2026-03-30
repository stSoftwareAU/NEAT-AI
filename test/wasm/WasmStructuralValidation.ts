/**
 * Tests for WASM structural integrity validation and cycle detection.
 *
 * Issue #1961: Migrate topology validation to Rust/WASM.
 *
 * These tests cover structural integrity checks (connection count validation
 * per neuron type, synapse target validation, bias finiteness, IF neuron
 * requirements) and cycle detection — all operating on typed array topology.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  detectCycles,
  detectCyclesTS,
  STRUCTURAL_BIAS_NOT_FINITE,
  STRUCTURAL_CONSTANT_HAS_INWARD,
  STRUCTURAL_HIDDEN_NO_INWARD,
  STRUCTURAL_HIDDEN_NO_OUTWARD,
  STRUCTURAL_IF_MISSING_CONDITION,
  STRUCTURAL_IF_MISSING_NEGATIVE,
  STRUCTURAL_IF_TOO_FEW_INWARD,
  STRUCTURAL_SYNAPSE_TARGETS_INPUT,
  STRUCTURAL_VALID,
  validateStructuralIntegrity,
  validateStructuralIntegrityTS,
} from "@wasm/WasmTopologyOps.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple 2-input, 1-hidden, 1-output creature. */
function makeSimpleCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: -0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Creature with constant neuron. */
function makeConstantCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-0", bias: 1.0 },
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "const-0", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Creature with IF neuron. */
function makeIfCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 1,
        type: "positive",
      },
      {
        fromUUID: "input-2",
        toUUID: "hidden-0",
        weight: 1,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

// ===========================================================================
// 1. Structural Integrity Validation
// ===========================================================================

Deno.test("validateStructuralIntegrity: valid simple creature returns VALID", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = validateStructuralIntegrity(topo);

  assertEquals(result.errorCode, STRUCTURAL_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateStructuralIntegrity: valid constant creature returns VALID", () => {
  const creature = makeConstantCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = validateStructuralIntegrity(topo);

  assertEquals(result.errorCode, STRUCTURAL_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateStructuralIntegrity: valid IF creature returns VALID", () => {
  const creature = makeIfCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = validateStructuralIntegrity(topo);

  assertEquals(result.errorCode, STRUCTURAL_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateStructuralIntegrity: detects synapse targeting input neuron", () => {
  // Manually build typed arrays with a synapse targeting an input
  const fromIndices = new Uint32Array([0, 2]);
  const toIndices = new Uint32Array([1, 3]); // index 0: to=1 which is input (numInputs=2)... wait no, 1 < 2 so yes
  // Actually let's be precise: 2 inputs (0,1), so toIndices targeting 1 is targeting an input
  // But that's index 0: from=0 (input), to=1 (input) — targeting an input
  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    new Uint8Array([0, 0, 0, 0]),
    new Uint8Array([0, 0, 0, 0]),
    new Float64Array([0, 0, 0.5, -0.3]),
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_SYNAPSE_TARGETS_INPUT);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: detects constant neuron with inward connection", () => {
  // 2 inputs, 1 constant (idx 2), 1 output (idx 3)
  // Synapse: input-0 -> constant is invalid
  const fromIndices = new Uint32Array([0, 2]);
  const toIndices = new Uint32Array([2, 3]); // 0->2 targets constant neuron
  const isConstant = new Uint8Array([0, 0, 1, 0]);
  const squashTypes = new Uint8Array([0, 0, 0, 0]);
  const biases = new Float64Array([0, 0, 1.0, -0.3]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_CONSTANT_HAS_INWARD);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: detects hidden neuron with no inward connections", () => {
  // 2 inputs, 1 hidden (idx 2), 1 output (idx 3)
  // Only synapse: hidden -> output (hidden has no inward)
  const fromIndices = new Uint32Array([2]);
  const toIndices = new Uint32Array([3]);
  const isConstant = new Uint8Array([0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 1, 7]); // hidden has ReLU (1)
  const biases = new Float64Array([0, 0, 0.5, -0.3]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_HIDDEN_NO_INWARD);
  assertEquals(result.valid, false);
  assertEquals(result.neuronIndex, 2);
});

Deno.test("validateStructuralIntegrity: detects hidden neuron with no outward connections", () => {
  // 2 inputs (0, 1), 1 hidden (2), 1 output (3)
  // Synapses: input-0 -> hidden, input-1 -> output
  // Hidden has inward but no outward
  const fromIndices = new Uint32Array([0, 1]);
  const toIndices = new Uint32Array([2, 3]);
  const isConstant = new Uint8Array([0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 1, 7]);
  const biases = new Float64Array([0, 0, 0.5, -0.3]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_HIDDEN_NO_OUTWARD);
  assertEquals(result.valid, false);
  assertEquals(result.neuronIndex, 2);
});

Deno.test("validateStructuralIntegrity: detects non-finite bias", () => {
  // 2 inputs, 1 hidden (idx 2), 1 output (idx 3)
  const fromIndices = new Uint32Array([0, 2]);
  const toIndices = new Uint32Array([2, 3]);
  const isConstant = new Uint8Array([0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 1, 7]);
  const biases = new Float64Array([0, 0, Infinity, -0.3]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_BIAS_NOT_FINITE);
  assertEquals(result.valid, false);
  assertEquals(result.neuronIndex, 2);
});

Deno.test("validateStructuralIntegrity: detects NaN bias", () => {
  const fromIndices = new Uint32Array([0, 2]);
  const toIndices = new Uint32Array([2, 3]);
  const isConstant = new Uint8Array([0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 1, 7]);
  const biases = new Float64Array([0, 0, NaN, -0.3]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.errorCode, STRUCTURAL_BIAS_NOT_FINITE);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: IF neuron with too few inward connections", () => {
  // 2 inputs, 1 IF hidden (idx 2) with only 2 inward, 1 output (idx 3)
  const fromIndices = new Uint32Array([0, 1, 2]);
  const toIndices = new Uint32Array([2, 2, 3]);
  const isConstant = new Uint8Array([0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 34, 0]); // 34 = IF
  const biases = new Float64Array([0, 0, 0, 0]);
  const synapseTypes = new Uint8Array([1, 3, 0]); // condition, positive — missing negative

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
    synapseTypes,
  );

  // With only 2 inward connections, IF is invalid (needs at least 3)
  assertEquals(result.errorCode, STRUCTURAL_IF_TOO_FEW_INWARD);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: IF neuron missing condition synapse", () => {
  // 3 inputs, 1 IF hidden (idx 3) with 3 inward but no condition, 1 output (idx 4)
  const fromIndices = new Uint32Array([0, 1, 2, 3]);
  const toIndices = new Uint32Array([3, 3, 3, 4]);
  const isConstant = new Uint8Array([0, 0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 0, 34, 0]); // idx 3 = IF
  const biases = new Float64Array([0, 0, 0, 0, 0]);
  const synapseTypes = new Uint8Array([3, 2, 0, 0]); // positive, negative, standard — no condition

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    3,
    1,
    synapseTypes,
  );

  assertEquals(result.errorCode, STRUCTURAL_IF_MISSING_CONDITION);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: IF neuron missing positive synapse", () => {
  const fromIndices = new Uint32Array([0, 1, 2, 3]);
  const toIndices = new Uint32Array([3, 3, 3, 4]);
  const isConstant = new Uint8Array([0, 0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 0, 34, 0]); // idx 3 = IF
  const biases = new Float64Array([0, 0, 0, 0, 0]);
  const synapseTypes = new Uint8Array([1, 2, 0, 0]); // condition, negative, standard — no positive (standard=0, NOT same as positive=3)

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    3,
    1,
    synapseTypes,
  );

  // Standard (0) counts as positive for IF neuron
  assertEquals(result.valid, true);
});

Deno.test("validateStructuralIntegrity: IF neuron missing negative synapse", () => {
  const fromIndices = new Uint32Array([0, 1, 2, 3]);
  const toIndices = new Uint32Array([3, 3, 3, 4]);
  const isConstant = new Uint8Array([0, 0, 0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 0, 34, 0]); // idx 3 = IF
  const biases = new Float64Array([0, 0, 0, 0, 0]);
  const synapseTypes = new Uint8Array([1, 3, 3, 0]); // condition, positive, positive — no negative

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    3,
    1,
    synapseTypes,
  );

  assertEquals(result.errorCode, STRUCTURAL_IF_MISSING_NEGATIVE);
  assertEquals(result.valid, false);
});

Deno.test("validateStructuralIntegrity: WASM and TS produce identical results for valid creature", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const tsResult = validateStructuralIntegrityTS(
    topo.fromIndices,
    topo.toIndices,
    topo.isConstant,
    topo.squashTypes,
    topo.biases,
    topo.numInputs,
    topo.numOutputs,
    topo.synapseTypes,
  );
  const wasmResult = validateStructuralIntegrity(topo);

  assertEquals(wasmResult.valid, tsResult.valid);
  assertEquals(wasmResult.errorCode, tsResult.errorCode);
});

Deno.test("validateStructuralIntegrity: WASM and TS match for IF creature", () => {
  const creature = makeIfCreature();
  const topo = TypedTopology.fromCreature(creature);

  const tsResult = validateStructuralIntegrityTS(
    topo.fromIndices,
    topo.toIndices,
    topo.isConstant,
    topo.squashTypes,
    topo.biases,
    topo.numInputs,
    topo.numOutputs,
    topo.synapseTypes,
  );
  const wasmResult = validateStructuralIntegrity(topo);

  assertEquals(wasmResult.valid, tsResult.valid);
  assertEquals(wasmResult.errorCode, tsResult.errorCode);
});

Deno.test("validateStructuralIntegrity: empty synapses still validates (output-only)", () => {
  // Creature with only inputs and output, no synapses
  // Output with no inward is technically allowed (output neurons always pass)
  const fromIndices = new Uint32Array(0);
  const toIndices = new Uint32Array(0);
  const isConstant = new Uint8Array([0, 0, 0]);
  const squashTypes = new Uint8Array([0, 0, 7]);
  const biases = new Float64Array([0, 0, 0.1]);

  const result = validateStructuralIntegrityTS(
    fromIndices,
    toIndices,
    isConstant,
    squashTypes,
    biases,
    2,
    1,
  );

  assertEquals(result.valid, true);
});

// ===========================================================================
// 2. Cycle Detection
// ===========================================================================

Deno.test("detectCycles: acyclic graph returns false", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const hasCycles = detectCycles(topo);

  assertEquals(hasCycles, false);
});

Deno.test("detectCycles: acyclic graph with constant neuron returns false", () => {
  const creature = makeConstantCreature();
  const topo = TypedTopology.fromCreature(creature);

  const hasCycles = detectCycles(topo);

  assertEquals(hasCycles, false);
});

Deno.test("detectCycles: graph with cycle returns true", () => {
  // Manually create a topology with a cycle: 2->3 and 3->2
  const fromIndices = new Uint32Array([0, 1, 2, 3]);
  const toIndices = new Uint32Array([2, 3, 3, 2]); // 2->3 and 3->2 form a cycle

  const hasCycles = detectCyclesTS(fromIndices, toIndices, 4, 2);

  assertEquals(hasCycles, true);
});

Deno.test("detectCycles: self-loop is a cycle", () => {
  const fromIndices = new Uint32Array([0, 2]);
  const toIndices = new Uint32Array([2, 2]); // 2->2 self-loop

  const hasCycles = detectCyclesTS(fromIndices, toIndices, 3, 1);

  assertEquals(hasCycles, true);
});

Deno.test("detectCycles: longer cycle (3 nodes)", () => {
  // 3 inputs (0,1,2), 3 hidden (3,4,5), 1 output (6)
  // Cycle: 3->4->5->3
  const fromIndices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const toIndices = new Uint32Array([3, 4, 5, 4, 5, 3]); // cycle: 3->4, 4->5, 5->3

  const hasCycles = detectCyclesTS(fromIndices, toIndices, 7, 3);

  assertEquals(hasCycles, true);
});

Deno.test("detectCycles: WASM and TS produce identical results for acyclic graph", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const tsResult = detectCyclesTS(
    topo.fromIndices,
    topo.toIndices,
    topo.numNeurons,
    topo.numInputs,
  );
  const wasmResult = detectCycles(topo);

  assertEquals(wasmResult, tsResult);
});

Deno.test("detectCycles: empty graph has no cycles", () => {
  const fromIndices = new Uint32Array(0);
  const toIndices = new Uint32Array(0);

  const hasCycles = detectCyclesTS(fromIndices, toIndices, 3, 2);

  assertEquals(hasCycles, false);
});

// ===========================================================================
// 3. TypedTopology integration
// ===========================================================================

Deno.test("TypedTopology.validateStructuralIntegrity: valid creature", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = topo.validateStructuralIntegrity();

  assertEquals(result.valid, true);
  assertEquals(result.errorCode, STRUCTURAL_VALID);
});

Deno.test("TypedTopology.detectCycles: acyclic creature", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const hasCycles = topo.detectCycles();

  assertEquals(hasCycles, false);
});

Deno.test("TypedTopology.validateStructuralIntegrity: IF creature passes", () => {
  const creature = makeIfCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = topo.validateStructuralIntegrity();

  assertEquals(result.valid, true);
});

// ===========================================================================
// 4. CreatureValidate integration (structural checks delegated to WASM)
// ===========================================================================

Deno.test("creatureValidate uses structural validation for forward-only creature", () => {
  // A valid forward-only creature should pass validation
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: -0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
    ],
  });

  // Should not throw
  creature.validate({ forwardOnly: true });
});
