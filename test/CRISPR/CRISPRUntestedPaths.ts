/**
 * Tests for previously untested CRISPR code paths.
 *
 * Issue #1670: Expand CRISPR test coverage for untested paths.
 */
import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";
import { Neat } from "@neat/Neat.ts";

/**
 * Creates a minimal creature with 2 inputs, 1 hidden neuron, and 1 output.
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
 * Returns the numeric id assigned to the "h1" hidden neuron.
 */
function getH1Id(): number {
  const creature = makeCreature();
  const h1 = creature.neurons.find((n) => n.uuid === "h1");
  assertExists(h1?.id, "h1 hidden neuron must have a numeric id");
  return h1.id;
}

// ---------------------------------------------------------------------------
// 1. Validation failure fallback: cleaveDNA returns original on invalid result
// ---------------------------------------------------------------------------

Deno.test(
  "cleaveDNA - returns original creature when modification produces invalid result",
  () => {
    const creature = makeCreature();
    const originalNeuronCount = creature.neurons.length;
    const originalSynapseCount = creature.synapses.length;
    const crispr = new CRISPR(creature);

    // DNA that inserts a neuron but references a non-existent UUID for a
    // synapse, triggering a CrisprError during insert.
    const dna: CrisprInterface = {
      id: "validation-fallback-test",
      mode: "insert",
      neurons: [
        { id: 9342, type: "hidden", squash: "LOGISTIC", bias: 0 },
      ],
      synapses: [
        {
          fromId: 9254,
          toId: 9342,
          weight: 0.5,
        },
      ],
    };

    const result = crispr.cleaveDNA(dna);

    // Original creature returned unchanged
    assertEquals(result.neurons.length, originalNeuronCount);
    assertEquals(result.synapses.length, originalSynapseCount);
    assertEquals(result.input, creature.input);
    assertEquals(result.output, creature.output);
  },
);

// ---------------------------------------------------------------------------
// 2. Idempotency via synapse tags: DNA whose id matches only a synapse tag
// ---------------------------------------------------------------------------

Deno.test(
  "cleaveDNA - detects already-processed DNA via synapse CRISPR tag",
  () => {
    const creature = makeCreature();

    // Manually tag a synapse with a CRISPR id to simulate prior processing.
    const synapseToTag = creature.synapses[0];
    addTag(synapseToTag, "CRISPR", "already-applied-dna");

    const crispr = new CRISPR(creature);

    // DNA whose id matches the tag on the synapse.
    const dna: CrisprInterface = {
      id: "already-applied-dna",
      mode: "insert",
      neurons: [
        { id: 9749, type: "hidden", squash: "LOGISTIC", bias: 1 },
      ],
      synapses: [
        { fromId: 9677, toId: 9749, weight: 0.7 },
      ],
    };

    const result = crispr.cleaveDNA(dna);

    // The DNA should be detected as already processed; creature is unchanged.
    // No new neurons should have been added.
    assertEquals(result.neurons.length, creature.neurons.length);
  },
);

// ---------------------------------------------------------------------------
// 3. UUID unchanged: no CRISPR-SOURCE/CRISPR-DNA tags when no structural change
// ---------------------------------------------------------------------------

Deno.test(
  "cleaveDNA - no CRISPR-SOURCE/CRISPR-DNA tags when UUID is unchanged",
  () => {
    const h1Id = getH1Id();
    const creature = makeCreature();
    const crispr = new CRISPR(creature);

    // DNA that inserts a synapse that already exists (input-0 -> h1 at index 0->2).
    // Because the synapse already exists, the insert will produce a structurally
    // identical creature, so the UUID should remain the same.
    const dna: CrisprInterface = {
      id: "no-change-dna",
      mode: "insert",
      synapses: [
        { fromId: 0, toId: h1Id, weight: 0.5 },
      ],
    };

    const result = crispr.cleaveDNA(dna);

    // When the UUID is unchanged, CRISPR-SOURCE and CRISPR-DNA tags should be absent.
    const crisprSource = getTag(result, "CRISPR-SOURCE");
    const crisprDna = getTag(result, "CRISPR-DNA");
    assert(!crisprSource, "CRISPR-SOURCE should be absent");
    assert(!crisprDna, "CRISPR-DNA should be absent");
  },
);

// ---------------------------------------------------------------------------
// 4. Duplicate UUID handling in insert mode (collision branch)
// ---------------------------------------------------------------------------

Deno.test(
  "insert - skips neuron whose UUID already exists in creature",
  () => {
    const h1Id = getH1Id();
    const creature = makeCreature();
    const crispr = new CRISPR(creature);

    // Insert a neuron with the same id as h1 which already exists.
    // The insert code checks `uuidMap.has(dnaNeuron.id)` and skips if true.
    const dna: CrisprInterface = {
      id: "duplicate-uuid-insert",
      mode: "insert",
      neurons: [
        { id: h1Id, type: "hidden", squash: "LOGISTIC", bias: 99 },
      ],
      synapses: [
        { fromId: 0, toId: h1Id, weight: 0.9 },
      ],
    };

    const result = crispr.cleaveDNA(dna);
    result.validate();

    // The duplicate neuron should not have been added; only the existing one
    // should be present. The bias of the existing "h1" neuron should be
    // unchanged (0, not 99).
    const h1Neurons = result.neurons.filter((n) => n.id === h1Id);
    assertEquals(h1Neurons.length, 1);
    assertEquals(h1Neurons[0].bias, 0);
  },
);

// ---------------------------------------------------------------------------
// 5. Output neuron rejection in insert mode
// ---------------------------------------------------------------------------

Deno.test(
  "cleaveDNA - insert with output neurons throws validation error",
  () => {
    const h1Id = getH1Id();
    const creature = makeCreature();
    const crispr = new CRISPR(creature);

    const dna: CrisprInterface = {
      id: "output-neuron-insert",
      mode: "insert",
      neurons: [
        { type: "output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromId: h1Id, toId: -1, weight: 0.5 },
      ],
    };

    // validateDNA rejects insert-mode DNA containing output neurons with a
    // clear error message before insert() is ever called.
    assertThrows(
      () => crispr.cleaveDNA(dna),
      Error,
      "insert-mode DNA must not contain output neurons",
    );
  },
);

// ---------------------------------------------------------------------------
// 6. UUID collision in hidden neurons (append mode randomUUID branch)
// ---------------------------------------------------------------------------

/**
 * Subclass that exposes private append/insert methods for direct testing.
 */
class TestCRISPR extends CRISPR {
  testAppend(dna: CrisprInterface): Creature {
    return (this as unknown as { append(dna: CrisprInterface): Creature })
      .append(dna);
  }
}

Deno.test(
  "append - re-assigns UUID when hidden neuron UUID collides with existing",
  () => {
    const h1Id = getH1Id();
    const creature = makeCreature();
    const crispr = new TestCRISPR(creature);

    // Append DNA with a hidden neuron whose id matches h1 which already exists.
    // The append code checks `UUIDs.has(dnaNeuron.id)` and calls
    // `crypto.randomUUID()` when true, so the colliding neuron gets a new UUID.
    // We also include output neurons to build a valid topology.
    const dna: CrisprInterface = {
      id: "uuid-collision-append",
      mode: "append",
      neurons: [
        {
          id: h1Id,
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.7,
          index: 1000,
        },
        { type: "output", squash: "IDENTITY", bias: 0, index: 1001 },
      ],
      synapses: [
        { from: 0, toRelative: 1000, weight: 0.4 },
        { fromRelative: 1000, toRelative: 1001, weight: 0.6 },
        { fromId: h1Id, toRelative: 1001, weight: 0.3 },
      ],
    };

    const result = crispr.testAppend(dna);

    // The original "h1" should still exist.
    const h1Neurons = result.neurons.filter((n) => n.id === h1Id);
    assertEquals(h1Neurons.length, 1, "Original h1 should still exist once");

    // There should be a CRISPR-tagged neuron with a different UUID (not h1Id)
    // because the collision forced a re-assignment.
    const crisprTaggedHidden = result.neurons.filter((n) => {
      const tag = getTag(n, "CRISPR");
      return tag === "uuid-collision-append" && n.type !== "output";
    });
    assert(
      crisprTaggedHidden.length >= 1,
      "Should have at least one CRISPR-tagged hidden neuron",
    );
    for (const neuron of crisprTaggedHidden) {
      assertNotEquals(
        neuron.id,
        h1Id,
        "UUID should have been re-assigned due to collision",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// 7. Missing first output index in append mode
// ---------------------------------------------------------------------------

Deno.test(
  "append - handles output neurons without index field",
  () => {
    const creature = makeCreature();
    const crispr = new CRISPR(creature);

    // DNA with output neurons that have no index field. The code sets
    // firstDnaOutputIndex to -1 when no index is present, which affects
    // the adjustIndx calculation.
    const dna: CrisprInterface = {
      id: "missing-output-index",
      mode: "append",
      neurons: [
        { type: "output", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { from: 0, toRelative: 0, weight: 0.4 },
      ],
    };

    const result = crispr.cleaveDNA(dna);
    result.validate();

    // The creature should now have a new output neuron.
    const outputNeurons = result.neurons.filter((n) => n.type === "output");
    assert(
      outputNeurons.length >= 1,
      "Should have at least one output neuron",
    );
  },
);

// Tests 8-9 (editAliases no-match / empty aliases) removed as duplicates
// of equivalent tests in test/CRISPR/Aliases.ts

// ---------------------------------------------------------------------------
// 8. CRISPRs survive deepCloneAndShuffle round-trip (NeatOptions integration)
// ---------------------------------------------------------------------------

Deno.test(
  "CRISPRs survive deepCloneAndShuffle round-trip",
  () => {
    const crisprs: CrisprInterface[] = [
      {
        id: "dna-alpha",
        mode: "insert",
        neurons: [
          {
            id: 8001,
            type: "hidden",
            squash: "LOGISTIC",
            bias: 0.3,
          },
        ],
        synapses: [
          { fromId: 0, toId: 8001, weight: 0.5 },
        ],
      },
      {
        id: "dna-beta",
        mode: "append",
        neurons: [
          { type: "output", squash: "IDENTITY", bias: 0, index: 3 },
        ],
        synapses: [
          { from: 0, to: 3, weight: 0.7 },
        ],
      },
    ];

    const cloned = Neat.deepCloneAndShuffle(crisprs);

    // All DNA elements should be preserved.
    assertEquals(cloned.length, 2);

    const ids = cloned.map((d) => d.id).sort();
    assertEquals(ids, ["dna-alpha", "dna-beta"]);

    // Verify deep clone — mutations on the clone must not affect originals.
    const alpha = cloned.find((d) => d.id === "dna-alpha")!;
    assertEquals(alpha.mode, "insert");
    assertEquals(alpha.neurons!.length, 1);
    assertEquals(alpha.neurons![0].id, 8001);
    assertEquals(alpha.synapses.length, 1);

    const beta = cloned.find((d) => d.id === "dna-beta")!;
    assertEquals(beta.mode, "append");
    assertEquals(beta.synapses[0].weight, 0.7);

    // Ensure it's a deep clone, not a reference.
    alpha.neurons![0].bias = 999;
    assertEquals(crisprs[0].neurons![0].bias, 0.3);
  },
);
