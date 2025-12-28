import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { buildDiscoveryCandidates } from "../../src/discovery/DiscoveryCandidates.ts";
import {
  buildCacheKey,
  recordFailure,
  recordFailureSync,
} from "../../src/discovery/FailureCache.ts";
import { closeRustLibrary } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}

function makeAddSynapseCandidate(): CandidateSynapse {
  return {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 10,
    totalCount: 10,
    comment: "failure-cache-test",
  };
}

function makeSplitCandidate(): SplitSynapseInsertNeuronCandidate {
  return {
    type: "split_synapse_insert_neuron",
    fromNeuronUuid: "hidden-0",
    toNeuronUuid: "output-0",
    oldWeight: 0.25,
    newNeuron: {
      uuid: "hidden-split-0",
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0,
    },
    newSynapses: [
      { from_uuid: "hidden-0", to_uuid: "hidden-split-0", weight: 0.6 },
      { from_uuid: "hidden-split-0", to_uuid: "output-0", weight: 0.7 },
    ],
    expectedCreatureScoreGain: 0.02,
    comment: "failure-cache-test",
  };
}

Deno.test("FailureCache records split-synapse rustRequest (sync + async)", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-failure-cache-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: [makeSplitCandidate()],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const split = candidates.find((c) =>
    c.change.type === "split-synapse-insert-neuron"
  );
  if (!split) {
    throw new Error("Expected split-synapse candidate to be built");
  }

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-failure-cache-split-",
  });
  try {
    const filePath = join(
      cacheDir,
      split.change.type,
      `${buildCacheKey(split)}.json`,
    );

    recordFailureSync(
      cacheDir,
      split,
      { originalScore: 1, candidateScore: 0.9, scoreDelta: -0.1, error: 1 },
      baseCreature,
    );

    const parsedSync = JSON.parse(await Deno.readTextFile(filePath)) as Record<
      string,
      unknown
    >;
    const rustRequestSync = parsedSync.rustRequest as Record<string, unknown>;
    assertEquals(
      typeof rustRequestSync?.splitSynapseInsertNeuronCandidate,
      "object",
    );

    // Also exercise the async recorder (same file path).
    await recordFailure(
      cacheDir,
      split,
      { originalScore: 1, candidateScore: 0.9, scoreDelta: -0.1, error: 1 },
      baseCreature,
    );

    const parsedAsync = JSON.parse(await Deno.readTextFile(filePath)) as Record<
      string,
      unknown
    >;
    const rustRequestAsync = parsedAsync.rustRequest as Record<string, unknown>;
    assertEquals(
      typeof rustRequestAsync?.splitSynapseInsertNeuronCandidate,
      "object",
    );
  } finally {
    // If `getDiscoveryVersion()` loaded the FFI library, unload it to satisfy
    // Deno's leak detector for this test case.
    closeRustLibrary();

    // Best-effort cleanup. (On Windows, open file handles can keep dirs locked.)
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // ignore
    }
  }
});
