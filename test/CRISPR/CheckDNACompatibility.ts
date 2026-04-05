/**
 * Tests for pre-flight DNA-creature UUID compatibility check.
 *
 * Issue #2155: Add pre-flight DNA-creature UUID compatibility check in CRISPR.
 *
 * The pre-flight check catches all missing UUID references before any creature
 * modification occurs, providing a single diagnostic listing all missing UUIDs.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Creature } from "@creature";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import { CRISPR, type CrisprInterface } from "@reconstruct/CRISPR.ts";
import { CrisprError } from "@errors/CrisprError.ts";

/**
 * Creates a minimal creature with 2 inputs, 1 hidden neuron, and 1 output
 * using internal format (used for pre-flight rejection tests where validation
 * of the modified creature is not needed).
 */
function makeCreature(): Creature {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 2, uuid: "h1" },
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

/**
 * Creates a v4 creature suitable for tests where CRISPR modification must
 * succeed and validate cleanly.
 */
function makeV4Creature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    semanticVersion: "4.0.0",
    neurons: [
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  return Creature.fromJSON(json);
}

/**
 * Returns the numeric id assigned to the "h1" hidden neuron.
 */
function getH1Id(): number {
  const creature = makeCreature();
  const h1 = creature.neurons.find((n) => n.uuid === "h1");
  assert(h1?.id !== undefined, "h1 hidden neuron must have a numeric id");
  return h1.id;
}

// ---------------------------------------------------------------------------
// 1. Pre-flight check rejects insert-mode DNA with missing fromId UUID
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - insert mode rejects missing fromId", () => {
  const h1Id = getH1Id();
  const creature = makeCreature();
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-insert-from",
    mode: "insert",
    synapses: [
      { fromId: 999999999, toId: h1Id, weight: 0.3 },
    ],
  };

  // cleaveDNA should catch the pre-flight error and return original creature
  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
  assertEquals(result.neurons.length, creature.neurons.length);
});

// ---------------------------------------------------------------------------
// 2. Pre-flight check rejects insert-mode DNA with missing toId UUID
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - insert mode rejects missing toId", () => {
  const h1Id = getH1Id();
  const creature = makeCreature();
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-insert-to",
    mode: "insert",
    synapses: [
      { fromId: h1Id, toId: 888888888, weight: 0.3 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

// ---------------------------------------------------------------------------
// 3. Pre-flight check rejects append-mode DNA with missing fromId UUID
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - append mode rejects missing fromId", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-append-from",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 777777777, to: 0, weight: 0.5 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

// ---------------------------------------------------------------------------
// 4. Pre-flight check rejects append-mode DNA with missing toId UUID
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - append mode rejects missing toId", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-append-to",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, toId: 666666666, weight: 0.5 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
  assertEquals(result.output, creature.output);
});

// ---------------------------------------------------------------------------
// 5. Pre-flight check lists ALL missing UUIDs (not just the first)
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - error message lists all missing UUIDs", () => {
  const creature = makeCreature();

  class TestCRISPR extends CRISPR {
    testCheckCompatibility(dna: CrisprInterface): void {
      return (
        this as unknown as {
          checkDNACompatibility(dna: CrisprInterface): void;
        }
      ).checkDNACompatibility(dna);
    }
  }

  const crispr = new TestCRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-all-missing",
    mode: "insert",
    synapses: [
      { fromId: 111111111, toId: 222222222, weight: 0.3 },
      { fromId: 333333333, toId: 444444444, weight: 0.5 },
    ],
  };

  let caught: CrisprError | undefined;
  try {
    crispr.testCheckCompatibility(dna);
  } catch (e) {
    if (e instanceof CrisprError) {
      caught = e;
    } else {
      throw e;
    }
  }

  assert(caught !== undefined, "Should have thrown a CrisprError");
  assertEquals(caught.code, "MISSING_UUID");
  // All four missing UUIDs should be listed in the error message
  assertStringIncludes(caught.message, "111111111");
  assertStringIncludes(caught.message, "222222222");
  assertStringIncludes(caught.message, "333333333");
  assertStringIncludes(caught.message, "444444444");
});

// ---------------------------------------------------------------------------
// 6. DNA that defines new neurons and references them in synapses passes
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - DNA-defined neurons are included in UUID set", () => {
  const creature = makeV4Creature();
  const h1 = creature.neurons.find((n) => n.uuid === "h1");
  assert(h1?.id !== undefined, "h1 must have a numeric id");
  const h1Id = h1.id;

  const crispr = new CRISPR(creature);
  const newNeuronId = 505050505;

  const outputId = -1; // output neuron 0 has id -1

  const dna: CrisprInterface = {
    id: "test-preflight-new-neuron",
    mode: "insert",
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0,
        id: newNeuronId,
      },
    ],
    synapses: [
      { fromId: h1Id, toId: newNeuronId, weight: 0.3 },
      { fromId: newNeuronId, toId: outputId, weight: 0.5 },
    ],
  };

  // Should succeed — the new neuron is defined in the DNA itself
  const result = crispr.cleaveDNA(dna);
  // The creature should be modified (more neurons than original)
  assert(
    result.neurons.length > creature.neurons.length,
    "Creature should have the new neuron added",
  );
});

// ---------------------------------------------------------------------------
// 7. Compatible DNA continues to work without regression
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - compatible insert-mode DNA passes through", () => {
  const creature = makeV4Creature();
  const h1 = creature.neurons.find((n) => n.uuid === "h1");
  assert(h1?.id !== undefined, "h1 must have a numeric id");
  const h1Id = h1.id;

  const crispr = new CRISPR(creature);
  const newNeuronId = 606060606;

  const outputId = -1; // output neuron 0 has id -1

  const dna: CrisprInterface = {
    id: "test-preflight-compatible",
    mode: "insert",
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        id: newNeuronId,
      },
    ],
    synapses: [
      { fromId: h1Id, toId: newNeuronId, weight: 0.4 },
      { fromId: newNeuronId, toId: outputId, weight: 0.5 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  assert(
    result.neurons.length > creature.neurons.length,
    "Compatible DNA should modify the creature",
  );
});

// ---------------------------------------------------------------------------
// 8. Synapses using non-UUID references (from/to/fromRelative/toRelative)
//    are not checked by the pre-flight and still work
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - append mode with non-UUID refs passes through", () => {
  const creature = makeCreature();
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-non-uuid",
    mode: "append",
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 0, weight: 0.5 },
    ],
  };

  // Non-UUID synapses are not subject to pre-flight UUID check
  const result = crispr.cleaveDNA(dna);
  assertEquals(result.input, creature.input);
});

// ---------------------------------------------------------------------------
// 9. Mixed missing and valid UUIDs — only missing ones are reported
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - reports only missing UUIDs, not valid ones", () => {
  const h1Id = getH1Id();
  const creature = makeCreature();

  class TestCRISPR extends CRISPR {
    testCheckCompatibility(dna: CrisprInterface): void {
      return (
        this as unknown as {
          checkDNACompatibility(dna: CrisprInterface): void;
        }
      ).checkDNACompatibility(dna);
    }
  }

  const crispr = new TestCRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-mixed",
    mode: "insert",
    synapses: [
      { fromId: h1Id, toId: 999888777, weight: 0.3 },
    ],
  };

  let caught: CrisprError | undefined;
  try {
    crispr.testCheckCompatibility(dna);
  } catch (e) {
    if (e instanceof CrisprError) {
      caught = e;
    } else {
      throw e;
    }
  }

  assert(caught !== undefined, "Should have thrown a CrisprError");
  assertEquals(caught.code, "MISSING_UUID");
  // The missing UUID should be in the message
  assertStringIncludes(caught.message, "999888777");
  // The valid UUID should NOT be in the error message
  assertEquals(
    caught.message.includes(String(h1Id)),
    false,
    `Valid UUID ${h1Id} should not appear in error message`,
  );
});

// ---------------------------------------------------------------------------
// 10. Pre-flight check runs before creature modification (no cloning occurs)
// ---------------------------------------------------------------------------
Deno.test("checkDNACompatibility - catches errors before creature modification", () => {
  const creature = makeCreature();
  const originalNeuronCount = creature.neurons.length;
  const crispr = new CRISPR(creature);

  const dna: CrisprInterface = {
    id: "test-preflight-no-modification",
    mode: "insert",
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, id: 707070707 },
    ],
    synapses: [
      // Reference a valid new neuron but also a missing one
      { fromId: 707070707, toId: 808080808, weight: 0.3 },
    ],
  };

  const result = crispr.cleaveDNA(dna);
  // Should return original creature unchanged
  assertEquals(result.neurons.length, originalNeuronCount);
});
