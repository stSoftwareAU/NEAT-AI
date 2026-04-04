/**
 * Verifies that addHelpfulNeurons() enforces forward-only synapse constraints
 * when adding new neurons to forward-only creatures (Issue #2152).
 */
import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CandidateNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { addHelpfulNeurons } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronAddition.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

/**
 * Build a minimal forward-only creature:
 *   input-0 (idx 0)
 *   input-1 (idx 1)
 *   hidden-1 (idx 2)
 *   hidden-2 (idx 3)
 *   output-0 (idx 4)
 *
 * Synapses: input-0 -> hidden-1, hidden-1 -> hidden-2, hidden-2 -> output-0
 */
function makeForwardOnlyCreature(): Creature {
  const json: Parameters<typeof normaliseCreatureExport>[0] = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.4 },
    ],
  } as Parameters<typeof normaliseCreatureExport>[0];
  normaliseCreatureExport(json);
  const creature = Creature.fromJSON(
    json as Parameters<typeof Creature.fromJSON>[0],
  );
  creature.validate({ forwardOnly: true });
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeCandidateNeuron(
  fromUuid: string,
  toUuid: string,
  squash = "IDENTITY",
): CandidateNeuron {
  return {
    fromNeuronUuid: fromUuid,
    toNeuronUuid: toUuid,
    incomingWeight: 0.5,
    outgoingWeight: 0.3,
    squash,
    bias: 0,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.2,
    improvedCount: 5,
    totalCount: 10,
  };
}

Deno.test(
  "addHelpfulNeurons: valid forward neuron addition in forward-only creature produces no backward synapses",
  () => {
    const creature = makeForwardOnlyCreature();

    // Add a neuron between input-0 and hidden-2 (forward direction)
    const candidate = makeCandidateNeuron("input-0", "hidden-2");
    const result = addHelpfulNeurons("TEST-FORWARD", creature, [candidate]);

    if (result) {
      const exported = result.exportJSON();
      assertEquals(
        exported.forwardOnly,
        true,
        "Result should still be forward-only",
      );

      // Verify no backward synapses exist
      const inputCount = exported.input ?? 0;
      const uuidToIndex = new Map<string, number>();
      for (let i = 0; i < inputCount; i++) {
        uuidToIndex.set(`input-${i}`, i);
      }
      for (let i = 0; i < exported.neurons.length; i++) {
        const uuid = exported.neurons[i].uuid;
        if (uuid) uuidToIndex.set(uuid, inputCount + i);
      }

      for (const synapse of exported.synapses) {
        const fromIdx = uuidToIndex.get(synapse.fromUUID!);
        const toIdx = uuidToIndex.get(synapse.toUUID!);
        if (fromIdx !== undefined && toIdx !== undefined) {
          assertEquals(
            fromIdx < toIdx,
            true,
            `Synapse ${synapse.fromUUID} -> ${synapse.toUUID} violates forward-only (fromIdx=${fromIdx}, toIdx=${toIdx})`,
          );
        }
      }
    }
  },
);

Deno.test(
  "addHelpfulNeurons: backward candidate is rejected for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    // Attempt to add a neuron from hidden-2 to hidden-1 (backward direction)
    const backward = makeCandidateNeuron("hidden-2", "hidden-1");
    const result = addHelpfulNeurons("TEST-BACKWARD", creature, [backward]);

    assertEquals(
      result,
      undefined,
      "Backward neuron addition should be rejected for forward-only creature",
    );
  },
);

Deno.test(
  "addHelpfulNeurons: neuron addition with output target in forward-only creature creates no backward synapses",
  () => {
    const creature = makeForwardOnlyCreature();

    // Add a neuron between hidden-1 and output-0 (forward direction)
    const candidate = makeCandidateNeuron("hidden-1", "output-0");
    const result = addHelpfulNeurons("TEST-OUTPUT", creature, [candidate]);

    if (result) {
      const exported = result.exportJSON();

      // Verify no backward synapses
      const inputCount = exported.input ?? 0;
      const uuidToIndex = new Map<string, number>();
      for (let i = 0; i < inputCount; i++) {
        uuidToIndex.set(`input-${i}`, i);
      }
      for (let i = 0; i < exported.neurons.length; i++) {
        const uuid = exported.neurons[i].uuid;
        if (uuid) uuidToIndex.set(uuid, inputCount + i);
      }

      for (const synapse of exported.synapses) {
        const fromIdx = uuidToIndex.get(synapse.fromUUID!);
        const toIdx = uuidToIndex.get(synapse.toUUID!);
        if (fromIdx !== undefined && toIdx !== undefined) {
          assertEquals(
            fromIdx < toIdx,
            true,
            `Synapse ${synapse.fromUUID} -> ${synapse.toUUID} violates forward-only (fromIdx=${fromIdx}, toIdx=${toIdx})`,
          );
        }
      }
    }
  },
);

Deno.test(
  "addHelpfulNeurons: mixed candidates filtered correctly for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    const candidates: CandidateNeuron[] = [
      // Valid forward: input-1 -> hidden-2
      makeCandidateNeuron("input-1", "hidden-2"),
      // Invalid backward: output-0 -> hidden-1
      makeCandidateNeuron("output-0", "hidden-1"),
      // Invalid: hidden-2 -> hidden-1 (backward)
      makeCandidateNeuron("hidden-2", "hidden-1"),
    ];

    const result = addHelpfulNeurons("TEST-MIXED", creature, candidates);

    if (result) {
      const exported = result.exportJSON();

      // Verify all synapses are forward
      const inputCount = exported.input ?? 0;
      const uuidToIndex = new Map<string, number>();
      for (let i = 0; i < inputCount; i++) {
        uuidToIndex.set(`input-${i}`, i);
      }
      for (let i = 0; i < exported.neurons.length; i++) {
        const uuid = exported.neurons[i].uuid;
        if (uuid) uuidToIndex.set(uuid, inputCount + i);
      }

      for (const synapse of exported.synapses) {
        const fromIdx = uuidToIndex.get(synapse.fromUUID!);
        const toIdx = uuidToIndex.get(synapse.toUUID!);
        if (fromIdx !== undefined && toIdx !== undefined) {
          assertEquals(
            fromIdx < toIdx,
            true,
            `Synapse ${synapse.fromUUID} -> ${synapse.toUUID} violates forward-only`,
          );
        }
      }
    }
  },
);

Deno.test(
  "addHelpfulNeurons: self-referencing neuron candidate rejected for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    // Self-reference: hidden-1 -> hidden-1
    const selfRef = makeCandidateNeuron("hidden-1", "hidden-1");
    const result = addHelpfulNeurons("TEST-SELF", creature, [selfRef]);

    assertEquals(
      result,
      undefined,
      "Self-referencing neuron candidate should be rejected for forward-only creature",
    );
  },
);
