import { assertEquals } from "@std/assert";
import type {
  DiscoverResult,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { buildDiscoverResponsePayload } from "../../src/multithreading/workers/WorkerProcessor.ts";

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
