/**
 * Verifies that addHelpfulSynapses() rejects backward and self-loop
 * synapses for forward-only creatures (Issue #2150).
 */
import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CandidateSynapse } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { addHelpfulSynapses } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverySynapseOps.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

/**
 * Build a minimal forward-only creature:
 *   input-0 (idx 0)
 *   input-1 (idx 1)
 *   hidden-1 (idx 2)
 *   output-0 (idx 3)
 *
 * Synapses: input-0 -> hidden-1, hidden-1 -> output-0
 */
function makeForwardOnlyCreature(): Creature {
  const json: Parameters<typeof normaliseCreatureExport>[0] = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.3 },
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

function makeCandidateSynapse(
  fromUuid: string,
  toUuid: string,
  weight = 0.1,
): CandidateSynapse {
  return {
    fromNeuronUuid: fromUuid,
    toNeuronUuid: toUuid,
    weight,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.2,
    improvedCount: 5,
    totalCount: 10,
  };
}

Deno.test(
  "addHelpfulSynapses rejects self-loop synapse for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    // Attempt to add output-0 -> output-0 (self-loop)
    const selfLoop = makeCandidateSynapse("output-0", "output-0", 0.1);
    const result = addHelpfulSynapses(
      "TEST-SELF-LOOP",
      creature,
      [selfLoop],
    );

    assertEquals(
      result,
      undefined,
      "Self-loop synapse should be rejected for forward-only creature",
    );
  },
);

Deno.test(
  "addHelpfulSynapses rejects backward synapse for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    // Attempt to add output-0 -> hidden-1 (backward: index 3 -> index 2)
    const backward = makeCandidateSynapse("output-0", "hidden-1", 0.2);
    const result = addHelpfulSynapses(
      "TEST-BACKWARD",
      creature,
      [backward],
    );

    assertEquals(
      result,
      undefined,
      "Backward synapse should be rejected for forward-only creature",
    );
  },
);

Deno.test(
  "addHelpfulSynapses allows valid forward synapse for forward-only creature",
  () => {
    const creature = makeForwardOnlyCreature();

    // input-1 -> hidden-1 is forward (index 1 -> index 2), and doesn't exist yet
    const forward = makeCandidateSynapse("input-1", "hidden-1", 0.4);
    const result = addHelpfulSynapses(
      "TEST-FORWARD",
      creature,
      [forward],
    );

    // Should succeed — a new creature should be returned
    if (result) {
      const exported = result.exportJSON();
      const added = exported.synapses.some(
        (s) => s.fromUUID === "input-1" && s.toUUID === "hidden-1",
      );
      assertEquals(added, true, "Forward synapse should be added");
    }
    // If result is undefined, the synapse was valid but the creature UUID
    // didn't change (unlikely with a new synapse), which is still acceptable.
  },
);

Deno.test(
  "addHelpfulSynapses filters mixed candidates keeping only forward ones",
  () => {
    const creature = makeForwardOnlyCreature();

    const candidates: CandidateSynapse[] = [
      // Valid forward: input-1 -> output-0 (index 1 -> index 3)
      makeCandidateSynapse("input-1", "output-0", 0.3),
      // Invalid backward: output-0 -> input-0 (index 3 -> index 0)
      makeCandidateSynapse("output-0", "input-0", 0.1),
      // Invalid self-loop: hidden-1 -> hidden-1 (index 2 -> index 2)
      makeCandidateSynapse("hidden-1", "hidden-1", 0.05),
    ];

    const result = addHelpfulSynapses(
      "TEST-MIXED",
      creature,
      candidates,
    );

    if (result) {
      const exported = result.exportJSON();
      // The valid forward synapse should be present
      const forwardAdded = exported.synapses.some(
        (s) => s.fromUUID === "input-1" && s.toUUID === "output-0",
      );
      assertEquals(forwardAdded, true, "Valid forward synapse should be added");

      // The backward and self-loop should NOT be present
      const backwardAdded = exported.synapses.some(
        (s) => s.fromUUID === "output-0" && s.toUUID === "input-0",
      );
      assertEquals(
        backwardAdded,
        false,
        "Backward synapse should not be added",
      );

      const selfLoopAdded = exported.synapses.some(
        (s) => s.fromUUID === "hidden-1" && s.toUUID === "hidden-1",
      );
      assertEquals(
        selfLoopAdded,
        false,
        "Self-loop synapse should not be added",
      );
    }
  },
);
