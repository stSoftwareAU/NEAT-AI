/**
 * Tests for WASM topology operations — selective WASM residency for
 * read-heavy topology operations.
 *
 * Issue #1959: Migrate topology validation, connection availability
 * scanning, and neuron dependency analysis to WASM/Rust.
 *
 * Tests verify WASM results match the existing TypeScript implementations.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import {
  TOPOLOGY_BACKWARD_CONNECTION,
  TOPOLOGY_DUPLICATE_CONNECTION,
  TOPOLOGY_SELF_CONNECTION,
  TOPOLOGY_SORT_ERROR_FROM,
  TOPOLOGY_SORT_ERROR_TO,
  TOPOLOGY_VALID,
  validateTopology,
  validateTopologyTS,
} from "../../src/wasm/WasmTopologyOps.ts";
import {
  scanAvailableConnections,
  scanAvailableConnectionsTS,
} from "../../src/wasm/WasmTopologyOps.ts";
import {
  computeReverseTopologicalOrder as wasmComputeOrder,
  computeReverseTopologicalOrderTS,
} from "../../src/wasm/WasmTopologyOps.ts";
import { computeReverseTopologicalOrder } from "@propagate/TopologicalOrder.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

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

/** Larger creature with multiple hidden neurons and outputs. */
function makeLargerCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "ReLU", bias: 0.1 },
      { type: "hidden", uuid: "h-1", squash: "LOGISTIC", bias: -0.5 },
      { type: "hidden", uuid: "h-2", squash: "TANH", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-1", squash: "LOGISTIC", bias: -0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "h-2", weight: 0.8 },
      { fromUUID: "h-0", toUUID: "h-1", weight: 0.4 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h-1", toUUID: "output-0", weight: -0.7 },
      { fromUUID: "h-2", toUUID: "output-1", weight: 0.9 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Creature with a constant neuron. */
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

// ===========================================================================
// 1. Topology Validation (Forward-Only Checks)
// ===========================================================================

Deno.test("validateTopology: valid forward-only creature returns VALID", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = validateTopology(topo);

  assertEquals(result.errorCode, TOPOLOGY_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateTopology: larger valid creature returns VALID", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  const result = validateTopology(topo);

  assertEquals(result.errorCode, TOPOLOGY_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateTopology: detects self-connection", () => {
  // Manually create typed arrays with a self-connection
  const fromIndices = new Uint32Array([0, 2, 2]);
  const toIndices = new Uint32Array([2, 2, 3]); // index 1: from=2, to=2 is self-loop

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_SELF_CONNECTION);
  assertEquals(result.valid, false);
  assertEquals(result.synapseIndex, 1);
});

Deno.test("validateTopology: detects backward connection", () => {
  const fromIndices = new Uint32Array([0, 3, 2]);
  const toIndices = new Uint32Array([2, 1, 3]); // index 1: from=3 > to=1

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_BACKWARD_CONNECTION);
  assertEquals(result.valid, false);
  assertEquals(result.synapseIndex, 1);
});

Deno.test("validateTopology: detects sort error in from indices", () => {
  // from indices not non-decreasing: [0, 2, 1]
  const fromIndices = new Uint32Array([0, 2, 1]);
  const toIndices = new Uint32Array([2, 3, 3]);

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_SORT_ERROR_FROM);
  assertEquals(result.valid, false);
  assertEquals(result.synapseIndex, 2);
});

Deno.test("validateTopology: detects sort error in to indices within same from", () => {
  // Same from=0, to not increasing: [3, 2]
  const fromIndices = new Uint32Array([0, 0]);
  const toIndices = new Uint32Array([3, 2]);

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_SORT_ERROR_TO);
  assertEquals(result.valid, false);
  assertEquals(result.synapseIndex, 1);
});

Deno.test("validateTopology: detects duplicate connection", () => {
  const fromIndices = new Uint32Array([0, 0]);
  const toIndices = new Uint32Array([2, 2]);

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_DUPLICATE_CONNECTION);
  assertEquals(result.valid, false);
  assertEquals(result.synapseIndex, 1);
});

Deno.test("validateTopology: empty synapses are valid", () => {
  const fromIndices = new Uint32Array(0);
  const toIndices = new Uint32Array(0);

  const result = validateTopologyTS(fromIndices, toIndices);

  assertEquals(result.errorCode, TOPOLOGY_VALID);
  assertEquals(result.valid, true);
});

Deno.test("validateTopology: WASM and TS produce identical results for valid creature", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  const tsResult = validateTopologyTS(topo.fromIndices, topo.toIndices);
  const wasmResult = validateTopology(topo);

  assertEquals(wasmResult.valid, tsResult.valid);
  assertEquals(wasmResult.errorCode, tsResult.errorCode);
});

// ===========================================================================
// 2. Connection Availability Scanning
// ===========================================================================

Deno.test("scanAvailableConnections: returns correct slots for simple creature", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const available = scanAvailableConnections(topo);

  // Should be non-empty (there are unused slots)
  assert(available.length > 0, "Should find available connections");

  // Every returned slot should be forward-only (from < to)
  for (const [from, to] of available) {
    assert(from < to, `Connection ${from}->${to} should be forward-only`);
    assert(to >= topo.numInputs, `Target ${to} should be non-input`);
  }
});

Deno.test("scanAvailableConnections: excludes existing connections", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const available = scanAvailableConnections(topo);

  // Build a set of existing connections for lookup
  const existingSet = new Set<string>();
  for (let i = 0; i < topo.numSynapses; i++) {
    existingSet.add(`${topo.fromIndices[i]}->${topo.toIndices[i]}`);
  }

  // No available connection should already exist
  for (const [from, to] of available) {
    assert(
      !existingSet.has(`${from}->${to}`),
      `Connection ${from}->${to} already exists`,
    );
  }
});

Deno.test("scanAvailableConnections: excludes constant target neurons", () => {
  const creature = makeConstantCreature();
  const topo = TypedTopology.fromCreature(creature);

  const available = scanAvailableConnections(topo);

  // Find the constant neuron index
  let constantIdx = -1;
  for (let i = 0; i < topo.numNeurons; i++) {
    if (topo.isConstant[i] === 1) {
      constantIdx = i;
      break;
    }
  }
  assert(constantIdx >= 0, "Should have a constant neuron");

  // No available connection should target the constant neuron
  for (const [_from, to] of available) {
    assert(
      to !== constantIdx,
      `Connection should not target constant neuron at ${constantIdx}`,
    );
  }
});

Deno.test("scanAvailableConnections: matches existing TS implementation", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  // Get results from both implementations
  const tsResult = scanAvailableConnectionsTS(
    topo.fromIndices,
    topo.toIndices,
    topo.isConstant,
    topo.numNeurons,
    topo.numInputs,
  );
  const wasmResult = scanAvailableConnections(topo);

  // Both should return the same connections (order should match too)
  assertEquals(wasmResult.length, tsResult.length);
  for (let i = 0; i < wasmResult.length; i++) {
    assertEquals(
      wasmResult[i][0],
      tsResult[i][0],
      `From mismatch at index ${i}`,
    );
    assertEquals(
      wasmResult[i][1],
      tsResult[i][1],
      `To mismatch at index ${i}`,
    );
  }
});

Deno.test("scanAvailableConnections: matches CreatureTopology.computeAvailableConnections", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  // Use the existing creature method
  const creatureAvailable = creature.getAvailableConnections();

  // Use the WASM/TS topology ops
  const topoAvailable = scanAvailableConnections(topo);

  assertEquals(topoAvailable.length, creatureAvailable.length);
  for (let i = 0; i < topoAvailable.length; i++) {
    assertEquals(topoAvailable[i][0], creatureAvailable[i][0]);
    assertEquals(topoAvailable[i][1], creatureAvailable[i][1]);
  }
});

// ===========================================================================
// 3. Neuron Dependency Analysis (Reverse Topological Order)
// ===========================================================================

Deno.test("computeReverseTopologicalOrder: output neurons appear first", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const order = wasmComputeOrder(topo);

  assert(order.length > 0, "Should return non-empty order");

  // First element should be the output neuron (index 3 in a 2-input, 1-hidden, 1-output creature)
  const outputStart = creature.neurons.length - creature.output;
  assert(
    order[0] >= outputStart,
    `First neuron ${order[0]} should be an output (>= ${outputStart})`,
  );
});

Deno.test("computeReverseTopologicalOrder: excludes input neurons", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const order = wasmComputeOrder(topo);

  for (const idx of order) {
    assert(
      idx >= topo.numInputs,
      `Neuron ${idx} should not be an input (numInputs=${topo.numInputs})`,
    );
  }
});

Deno.test("computeReverseTopologicalOrder: matches existing TS implementation", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  // Existing TS implementation
  const tsOrder = computeReverseTopologicalOrder(creature);

  // WASM topology ops implementation
  const wasmOrder = wasmComputeOrder(topo);

  assertEquals(wasmOrder.length, tsOrder.length);
  for (let i = 0; i < wasmOrder.length; i++) {
    assertEquals(
      wasmOrder[i],
      tsOrder[i],
      `Order mismatch at position ${i}: WASM=${wasmOrder[i]} TS=${tsOrder[i]}`,
    );
  }
});

Deno.test("computeReverseTopologicalOrder: TS fallback matches for simple creature", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const tsOrder = computeReverseTopologicalOrder(creature);
  const fallback = computeReverseTopologicalOrderTS(
    topo.fromIndices,
    topo.toIndices,
    topo.numNeurons,
    topo.numInputs,
  );

  assertEquals(fallback.length, tsOrder.length);
  for (let i = 0; i < fallback.length; i++) {
    assertEquals(fallback[i], tsOrder[i]);
  }
});

Deno.test("computeReverseTopologicalOrder: handles creature with constant neuron", () => {
  const creature = makeConstantCreature();
  const topo = TypedTopology.fromCreature(creature);

  const order = wasmComputeOrder(topo);

  // Should include non-input neurons (hidden + output + constant)
  // but constant neurons may or may not appear depending on their connectivity
  for (const idx of order) {
    assert(idx >= topo.numInputs, `Index ${idx} should be >= numInputs`);
  }
});

Deno.test("computeReverseTopologicalOrder: all non-input neurons are included", () => {
  const creature = makeLargerCreature();
  const topo = TypedTopology.fromCreature(creature);

  const order = wasmComputeOrder(topo);

  // Should include all non-input neurons exactly once
  const expectedCount = topo.numNeurons - topo.numInputs;
  assertEquals(order.length, expectedCount);

  // Each should appear exactly once
  const seen = new Set(order);
  assertEquals(seen.size, expectedCount);
});

Deno.test("computeReverseTopologicalOrder: empty creature returns only output", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.4 },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);
  const order = wasmComputeOrder(topo);

  assertEquals(order.length, 1);
  assertEquals(order[0], 2); // Output neuron at index 2 (after 2 inputs)
});
