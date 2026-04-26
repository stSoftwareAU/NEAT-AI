/**
 * Tests for WASM structural integrity validation and cycle detection.
 *
 * Issue #1961: Structural validation and cycle detection delegated to the
 * NEAT-AI-core Rust topology operations.
 *
 * Issue #2415: TS fallbacks were removed once core stabilised. These tests
 * now exercise behavioural outcomes via the WASM-backed API. Edge cases
 * built from hand-constructed typed arrays (e.g. non-finite biases, IF
 * neurons missing synapses) are covered upstream in
 * `neat-core/src/topology_ops.rs` tests at the pinned revision.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  detectCycles,
  STRUCTURAL_VALID,
  validateStructuralIntegrity,
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

Deno.test("detectCycles: IF creature is acyclic", () => {
  const creature = makeIfCreature();
  const topo = TypedTopology.fromCreature(creature);

  const hasCycles = detectCycles(topo);

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
