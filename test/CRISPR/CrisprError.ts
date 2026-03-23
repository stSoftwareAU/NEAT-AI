/**
 * Tests for CrisprError — verifies that CRISPR operations use
 * CrisprError with appropriate codes instead of generic AssertionError.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { CRISPR } from "../../src/reconstruct/CRISPR.ts";
import type { CrisprInterface } from "../../src/reconstruct/CRISPR.ts";
import { CrisprError } from "../../src/errors/CrisprError.ts";

/** Minimal creature for testing. */
function makeCreature(): Creature {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 2, id: 1003273 },
      { type: "output", squash: "IDENTITY", bias: 0, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 2, to: 3, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

// --- CrisprError class tests ---

Deno.test("CrisprError - has correct name and code properties", () => {
  const error = new CrisprError("test message", "INVALID_DNA");
  assertEquals(error.name, "CrisprError");
  assertEquals(error.code, "INVALID_DNA");
  assertEquals(error.message, "test message");
  assert(error instanceof Error, "Should be an instance of Error");
  assert(error instanceof CrisprError, "Should be an instance of CrisprError");
});

Deno.test("CrisprError - supports all error codes", () => {
  const codes = [
    "INVALID_DNA",
    "MISSING_UUID",
    "INVALID_CONNECTION",
    "TOPOLOGY_ERROR",
  ] as const;

  for (const code of codes) {
    const error = new CrisprError(`test ${code}`, code);
    assertEquals(error.code, code);
    assertEquals(error.name, "CrisprError");
  }
});

// --- cleaveDNA catches CrisprError for missing UUIDs and returns original ---

Deno.test("CrisprError - insert with missing fromUUID returns original creature", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-missing-from-uuid",
    mode: "insert",
    synapses: [
      { fromId: 576206823, toId: 1003273, weight: 0.3 },
    ],
  };

  // cleaveDNA should catch the CrisprError and return the original creature
  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

Deno.test("CrisprError - insert with missing toUUID returns original creature", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-missing-to-uuid",
    mode: "insert",
    synapses: [
      { fromId: 1003273, toId: 576206823, weight: 0.3 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

Deno.test("CrisprError - append with invalid from connection returns original creature", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-invalid-from",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 1928511767, to: 0, weight: 0.5 },
    ],
  };

  // The fromUUID doesn't resolve, so cleaveDNA should catch and return original
  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

Deno.test("CrisprError - append with invalid to connection returns original creature", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-invalid-to",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, toId: 1928511767, weight: 0.5 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

// --- Direct insert()/append() throw CrisprError (bypassing cleaveDNA catch) ---
// We test these via a subclass that exposes private methods for direct testing.

class TestCRISPR extends CRISPR {
  testInsert(dna: CrisprInterface): Creature {
    // Access the private insert method via bracket notation
    return (this as unknown as { insert(dna: CrisprInterface): Creature })
      .insert(dna);
  }

  testAppend(dna: CrisprInterface): Creature {
    return (this as unknown as { append(dna: CrisprInterface): Creature })
      .append(dna);
  }
}

Deno.test("CrisprError - insert throws INVALID_DNA for output neurons", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-output",
    mode: "insert",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 1003273, toId: -1, weight: 0.3 },
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Cannot insert output neurons",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("CrisprError - insert throws INVALID_DNA for relative synapses", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-relative",
    mode: "insert",
    synapses: [
      { fromRelative: 0, toRelative: 1, weight: 0.3 },
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Cannot insert relative synapses",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("CrisprError - insert throws INVALID_DNA for static from index", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-static-from",
    mode: "insert",
    synapses: [
      { from: 0, toId: 1003273, weight: 0.3 },
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Cannot insert static index (from) synapses",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("CrisprError - insert throws INVALID_DNA for missing synapse UUID", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-missing-synapse-uuid",
    mode: "insert",
    synapses: [
      { weight: 0.3 } as CrisprInterface["synapses"][0],
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Missing UUID for synapse",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("CrisprError - insert throws MISSING_UUID when fromUUID not found", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-missing-from",
    mode: "insert",
    synapses: [
      { fromId: 487454369, toId: 1003273, weight: 0.3 },
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Invalid connection (from)",
  );
  assertEquals(error.code, "MISSING_UUID");
});

Deno.test("CrisprError - insert throws MISSING_UUID when toUUID not found", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-insert-missing-to",
    mode: "insert",
    synapses: [
      { fromId: 1003273, toId: 487454369, weight: 0.3 },
    ],
  };

  const error = assertThrows(
    () => crispr.testInsert(dna),
    CrisprError,
    "Invalid connection (to)",
  );
  assertEquals(error.code, "MISSING_UUID");
});

Deno.test("CrisprError - append throws INVALID_CONNECTION for unresolvable from", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-append-invalid-from",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 1928511767, weight: 0.5 },
    ],
  };

  const error = assertThrows(
    () => crispr.testAppend(dna),
    CrisprError,
    "Invalid connection (from)",
  );
  assertEquals(error.code, "INVALID_CONNECTION");
});

Deno.test("CrisprError - append throws INVALID_CONNECTION for unresolvable to", () => {
  const creature = makeCreature();
  const crispr = new TestCRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-append-invalid-to",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, toId: 1928511767, weight: 0.5 },
    ],
  };

  const error = assertThrows(
    () => crispr.testAppend(dna),
    CrisprError,
    "Invalid connection (to)",
  );
  assertEquals(error.code, "INVALID_CONNECTION");
});

// --- cleaveDNA operational error handling ---

Deno.test("CrisprError - cleaveDNA returns original creature on operational CrisprError", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);
  const dna: CrisprInterface = {
    id: "test-operational-error",
    mode: "insert",
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, id: 105712059 },
    ],
    synapses: [
      { fromId: 487454369, toId: 105712059, weight: 0.3 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  // Should return the original creature unchanged
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
  assertEquals(result.neurons.length, creature.neurons.length);
});
