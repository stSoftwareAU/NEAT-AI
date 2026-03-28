import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildDiscoveryCandidates,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { normaliseCreatureExport } from "../../src/architecture/NormaliseCreatureExport.ts";

function makeBaselineCreature(): Creature {
  const json: Parameters<typeof normaliseCreatureExport>[0] = {
    input: 4,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.15 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 0.05 },
    ],
  } as Parameters<typeof normaliseCreatureExport>[0];
  normaliseCreatureExport(json);
  const creature = Creature.fromJSON(
    json as Parameters<typeof Creature.fromJSON>[0],
  );
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "harmful synapse removal appears as remove-synapse candidate in evaluation output",
  () => {
    const base = makeBaselineCreature();
    // Use an existing synapse from the base creature as the harmful one
    const harmfulSynapse: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      weight: -50.0, // Large negative weight simulating harmful synapse
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.35,
      improvedCount: 8,
      totalCount: 10,
    };

    const discovery: DiscoverResult = {
      ID: "HARMFUL-SYNAPSE-TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: harmfulSynapse,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);

    // Verify that a "remove-synapse" candidate exists
    const removeSynapseCandidate = candidates.find(
      (c) => c.change.type === "remove-synapse",
    );
    assert(
      removeSynapseCandidate,
      "Expected 'remove-synapse' candidate to appear in evaluation output",
    );

    // Verify the candidate has the harmful synapse removed
    const exported = removeSynapseCandidate.creature.exportInternalJSON();
    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === harmfulSynapse.fromNeuronUuid &&
      synapse.toUUID === harmfulSynapse.toNeuronUuid
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Harmful synapse should be removed in the remove-synapse candidate",
    );

    // Verify candidate metadata
    assertEquals(
      removeSynapseCandidate.change.type,
      "remove-synapse",
      "Candidate type should be 'remove-synapse'",
    );
    assert(
      removeSynapseCandidate.change.description?.includes("✂️"),
      "Description should include scissors emoji",
    );
    assert(
      removeSynapseCandidate.change.description?.includes("harmful"),
      "Description should mention harmful synapse",
    );
    assertEquals(
      removeSynapseCandidate.change.sampleSize,
      harmfulSynapse.totalCount,
      "Sample size should match harmful synapse total count",
    );
  },
);

Deno.test(
  "removeSynapse returns valid creature when synapse exists",
  () => {
    const base = makeBaselineCreature();
    // Target an existing synapse in the creature (input-0 → hidden-1)
    const existingSynapse: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      weight: 0.1, // Match existing weight
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = DiscoverStructure.removeSynapse(
      "TEST-REMOVE",
      base,
      existingSynapse,
    );

    assert(
      result,
      "removeSynapse should return a creature when synapse exists",
    );

    // Verify the synapse is actually removed
    const exported = result.exportInternalJSON();
    const synapseStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === existingSynapse.fromNeuronUuid &&
      synapse.toUUID === existingSynapse.toNeuronUuid
    );
    assertEquals(
      synapseStillExists,
      false,
      "Synapse should not exist in returned creature",
    );

    // Verify creature is valid
    result.validate();
  },
);

Deno.test(
  "removeSynapse returns null and logs warning when synapse doesn't exist",
  () => {
    const base = makeBaselineCreature();
    // Target a non-existent synapse (input-3 → output-1)
    const nonExistentSynapse: CandidateSynapse = {
      fromNeuronUuid: "input-3",
      toNeuronUuid: "output-1",
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.15,
      improvedCount: 3,
      totalCount: 8,
    };

    // Verify synapse doesn't exist
    const exported = base.exportInternalJSON();
    const exists = exported.synapses.some((synapse) =>
      synapse.fromUUID === nonExistentSynapse.fromNeuronUuid &&
      synapse.toUUID === nonExistentSynapse.toNeuronUuid
    );
    assertEquals(exists, false, "Precondition: synapse should not exist");

    // removeSynapse should return null (and log a warning)
    const result = DiscoverStructure.removeSynapse(
      "TEST-NON-EXISTENT",
      base,
      nonExistentSynapse,
    );

    assertEquals(
      result,
      null,
      "removeSynapse should return null when synapse doesn't exist",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates skips remove-synapse candidate when synapse doesn't exist",
  () => {
    const base = makeBaselineCreature();
    // Use a synapse that doesn't exist in the creature (input-3 → output-1)
    const nonExistentHarmfulSynapse: CandidateSynapse = {
      fromNeuronUuid: "input-3",
      toNeuronUuid: "output-1",
      weight: -10.0,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.4,
      improvedCount: 8,
      totalCount: 10,
    };

    const discovery: DiscoverResult = {
      ID: "NON-EXISTENT-HARMFUL",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: nonExistentHarmfulSynapse,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);

    // Should not produce a remove-synapse candidate
    const removeSynapseCandidate = candidates.find(
      (c) => c.change.type === "remove-synapse",
    );
    assertEquals(
      removeSynapseCandidate,
      undefined,
      "Should not create remove-synapse candidate for non-existent synapse",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates does not build combined removal candidates during Phase 1 (skipCombinedCandidates)",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "REMOVAL-SKIP-COMBOS",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      candidateSquashes: undefined,
      removalCandidates: [
        {
          neuronUuid: "hidden-1",
          totalError: 0,
          impact: 1e-11,
          reason: "test-removal-1",
        },
        {
          neuronUuid: "hidden-2",
          totalError: 0,
          impact: 1e-10,
          reason: "test-removal-2",
        },
      ],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    // We expect exactly one candidate per removal suggestion (no combined "cleanup" candidate).
    const removalCandidates = candidates.filter((c) =>
      c.change.type === "remove-low-impact"
    );
    assertEquals(
      removalCandidates.length,
      2,
      "Expected only dedicated remove-low-impact candidates when combos are skipped",
    );

    // Defensive: ensure none look like a combined cleanup description.
    const hasCombinedCleanup = removalCandidates.some((c) =>
      (c.change.description ?? "").toLowerCase().includes("combined")
    );
    assertEquals(
      hasCombinedCleanup,
      false,
      "Expected no combined removal candidate when skipCombinedCandidates is true",
    );
  },
);
