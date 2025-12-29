import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { buildDiscoveryCandidates } from "../../src/discovery/DiscoveryCandidates.ts";
import { buildCacheKey } from "../../src/discovery/FailureCache.ts";
import { closeRustLibrary } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import {
  deleteSuccessSync,
  listSuccessEntriesSync,
  recordSuccessSync,
} from "../../src/discovery/SuccessCache.ts";

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
    comment: "success-cache-test",
  };
}

Deno.test("SuccessCache records, lists, and deletes entries (sync)", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const addSynapse = candidates.find((c) => c.change.type === "add-synapses");
  if (!addSynapse) {
    throw new Error("Expected add-synapses candidate to be built");
  }

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-",
  });

  try {
    recordSuccessSync(
      cacheDir,
      addSynapse,
      {
        originalScore: 1,
        candidateScore: 1.1,
        scoreDelta: 0.1,
        originalError: 1,
        error: 0.9,
      },
      baseCreature,
    );

    const expectedFilePath = join(
      cacheDir,
      addSynapse.change.type,
      `${buildCacheKey(addSynapse)}.json`,
    );

    const parsed = JSON.parse(
      await Deno.readTextFile(expectedFilePath),
    ) as Record<string, unknown>;
    assertEquals(parsed.changeType, addSynapse.change.type);
    assertEquals(typeof parsed.timestamp, "string");

    const listed = listSuccessEntriesSync(cacheDir);
    assertEquals(listed.length, 1);
    assertEquals(listed[0].key, buildCacheKey(addSynapse));
    assertEquals(listed[0].changeType, addSynapse.change.type);

    deleteSuccessSync(cacheDir, addSynapse);
    const listedAfterDelete = listSuccessEntriesSync(cacheDir);
    assertEquals(listedAfterDelete.length, 0);
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failure in tests.
    }
  }
});
