import { assertEquals } from "@std/assert";
import type {
  CoordinatedStructuralCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type {
  DiscoverResult,
  RemovalCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildDiscoverResponsePayload,
  clearDiscoverResultForGC,
} from "../../src/multithreading/workers/WorkerProcessor.ts";

Deno.test("WorkerProcessor: discover response includes coordinated structural candidates", () => {
  const coordinated: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.5,
      },
    ],
  };

  const result: DiscoverResult = {
    ID: "test-discover",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: [coordinated],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const payload = buildDiscoverResponsePayload(result);
  assertEquals(payload.coordinatedStructuralCandidates?.length, 1);
  assertEquals(
    payload.coordinatedStructuralCandidates?.[0].type,
    "coordinated_structural",
  );
  assertEquals(
    payload.coordinatedStructuralCandidates?.[0].operations.length,
    2,
  );
});

Deno.test("WorkerProcessor: buildDiscoverResponsePayload maps all optional fields when present", () => {
  const coordinated: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [{
      type: "removeSynapse",
      fromNeuronUuid: "input-0",
      toNeuronUuid: "output-0",
    }],
  };

  const helpfulSynapse: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 1,
    totalCount: 1,
  };

  const helpfulNeuron: CandidateNeuron = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    incomingWeight: 0.1,
    outgoingWeight: 0.2,
    squash: "IDENTITY",
    bias: 0.01,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 1,
    totalCount: 1,
  };

  const harmfulSynapse: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-0",
    weight: -0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: -0.01,
    expectedCreatureScoreGain: -0.01,
    improvedCount: 0,
    totalCount: 1,
  };

  const harmfulNeuron: CandidateHarmfulNeuron = {
    neuronUUID: "hidden-0",
    errorMagnitude: 1,
    expectedCreatureScoreGain: 0.01,
    sampleCount: 1,
    averageActivation: 0,
  };

  const removal: RemovalCandidate = {
    neuronUUID: "hidden-1",
    totalError: 1,
    impact: 0.0001,
    reason: "test",
  };

  const squash: CandidateSquash = {
    neuronUUID: "output-0",
    previousSquash: "IDENTITY",
    squash: "TANH",
    expectedCreatureScoreGain: 0.01,
    improvedError: 0.9,
    currentError: 1.0,
  };

  const result: DiscoverResult = {
    ID: "test-discover-all-fields",
    addHelpfulSynapses: [helpfulSynapse],
    addHelpfulNeurons: [helpfulNeuron],
    coordinatedStructuralCandidates: [coordinated],
    removeHarmfulSynapse: harmfulSynapse,
    removeHarmfulNeurons: [harmfulNeuron],
    removalCandidates: [removal],
    candidateSquashes: [squash],
  };

  const payload = buildDiscoverResponsePayload(result);

  assertEquals(payload.ID, "test-discover-all-fields");

  // Arrays should be copied (not aliased) so caller can't mutate the worker's result arrays.
  assertEquals(payload.addHelpfulSynapses?.[0].toNeuronUUID, "output-0");
  assertEquals(payload.addHelpfulSynapses === result.addHelpfulSynapses, false);

  assertEquals(payload.addHelpfulNeurons?.[0].toNeuronUUID, "output-0");
  assertEquals(payload.addHelpfulNeurons === result.addHelpfulNeurons, false);

  assertEquals(
    payload.coordinatedStructuralCandidates?.[0].type,
    "coordinated_structural",
  );
  assertEquals(
    payload.coordinatedStructuralCandidates ===
      result.coordinatedStructuralCandidates,
    false,
  );

  assertEquals(payload.removeHarmfulSynapse?.toNeuronUUID, "hidden-0");
  assertEquals(payload.removeHarmfulNeurons?.[0].neuronUUID, "hidden-0");
  assertEquals(payload.removalCandidates?.[0].neuronUUID, "hidden-1");
  assertEquals(payload.candidateSquashes?.[0].squash, "TANH");
});

Deno.test("WorkerProcessor: clearDiscoverResultForGC clears coordinatedStructuralCandidates alongside other arrays", () => {
  const result = {
    ID: "gc-test",
    addHelpfulSynapses: [{}],
    addHelpfulNeurons: [{}],
    coordinatedStructuralCandidates: [{}],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: [{}],
    removalCandidates: [{}],
    candidateSquashes: [{}],
  } as unknown as DiscoverResult;

  clearDiscoverResultForGC(result);

  // These are intentionally nulled to drop references for GC.
  assertEquals(
    (result as unknown as { addHelpfulSynapses: unknown }).addHelpfulSynapses,
    null,
  );
  assertEquals(
    (result as unknown as { addHelpfulNeurons: unknown }).addHelpfulNeurons,
    null,
  );
  assertEquals(
    (result as unknown as { coordinatedStructuralCandidates: unknown })
      .coordinatedStructuralCandidates,
    null,
  );
  assertEquals(
    (result as unknown as { removeHarmfulNeurons: unknown })
      .removeHarmfulNeurons,
    null,
  );
  assertEquals(
    (result as unknown as { removalCandidates: unknown }).removalCandidates,
    null,
  );
  assertEquals(
    (result as unknown as { candidateSquashes: unknown }).candidateSquashes,
    null,
  );
});
