import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CandidateNeuron } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
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

function makeAddNeuronCandidatesWithKeyCollision(): CandidateNeuron[] {
  // Two candidates that intentionally collide under buildCacheKey() because it
  // buckets weights/biases by exponent only (e.g. 0.11 and 0.19 are both e-1).
  return [
    {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "output-0",
      incomingWeight: 0.11,
      outgoingWeight: 0.12,
      squash: "TANH",
      bias: 0.13,
      targetNeuronImpact: 1,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 10,
      totalCount: 10,
      comment: "success-cache-collision-a",
    },
    {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "output-0",
      incomingWeight: 0.19,
      outgoingWeight: 0.18,
      squash: "TANH",
      bias: 0.17,
      targetNeuronImpact: 1,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 10,
      totalCount: 10,
      comment: "success-cache-collision-b",
    },
  ];
}

Deno.test("SuccessCache records, lists, and deletes entries (sync)", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
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

Deno.test("SuccessCache does not overwrite on key collisions", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-collision-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: makeAddNeuronCandidatesWithKeyCollision(),
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  // buildDiscoveryCandidates may still emit combined add-neurons candidates; for this
  // test we only care about dedicated single-step add-neuron candidates.
  const addNeurons = candidates.filter((c) =>
    c.change.type === "add-neurons" && c.change.neuronDetails !== undefined
  );
  assertEquals(addNeurons.length, 2);

  const keyA = buildCacheKey(addNeurons[0]);
  const keyB = buildCacheKey(addNeurons[1]);
  assertEquals(
    keyA,
    keyB,
    "Precondition: candidates should collide under buildCacheKey()",
  );

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-collision-",
  });

  try {
    recordSuccessSync(
      cacheDir,
      addNeurons[0],
      {
        originalScore: 1,
        candidateScore: 1.01,
        scoreDelta: 0.01,
        originalError: 1,
        error: 0.99,
      },
      baseCreature,
    );
    recordSuccessSync(
      cacheDir,
      addNeurons[1],
      {
        originalScore: 1,
        candidateScore: 1.02,
        scoreDelta: 0.02,
        originalError: 1,
        error: 0.98,
      },
      baseCreature,
    );

    const listed = listSuccessEntriesSync(cacheDir).filter((e) =>
      e.changeType === "add-neurons"
    );
    assertEquals(
      listed.length,
      1,
      "Expected colliding candidates to be de-duplicated into a single cached entry",
    );
    assertEquals(
      listed[0].scoreDelta,
      0.02,
      "Expected the best-scoring entry to be retained for the key",
    );
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failure in tests.
    }
  }
});

Deno.test("SuccessCache retains the existing entry when the new one is worse", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-worse-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const addSynapse = candidates.find((c) => c.change.type === "add-synapses");
  if (!addSynapse) throw new Error("Expected add-synapses candidate");

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-worse-",
  });

  try {
    // First: better entry.
    recordSuccessSync(
      cacheDir,
      addSynapse,
      {
        originalScore: 1,
        candidateScore: 1.2,
        scoreDelta: 0.2,
        originalError: 1,
        error: 0.8,
      },
      baseCreature,
    );

    // Second: worse entry (should be ignored).
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
    ) as { scoreDelta?: number; candidateScore?: number };

    assertEquals(parsed.scoreDelta, 0.2);
    assertEquals(parsed.candidateScore, 1.2);
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failure in tests.
    }
  }
});

Deno.test("SuccessCache overwrites corrupt entries (best-effort)", async () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-corrupt-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const addSynapse = candidates.find((c) => c.change.type === "add-synapses");
  if (!addSynapse) throw new Error("Expected add-synapses candidate");

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-corrupt-",
  });

  try {
    const expectedFilePath = join(
      cacheDir,
      addSynapse.change.type,
      `${buildCacheKey(addSynapse)}.json`,
    );
    await Deno.mkdir(join(cacheDir, addSynapse.change.type), {
      recursive: true,
    });
    await Deno.writeTextFile(expectedFilePath, "{ this is not valid json");

    recordSuccessSync(
      cacheDir,
      addSynapse,
      {
        originalScore: 1,
        candidateScore: 1.05,
        scoreDelta: 0.05,
        originalError: 1,
        error: 0.95,
      },
      baseCreature,
    );

    const parsed = JSON.parse(
      await Deno.readTextFile(expectedFilePath),
    ) as { scoreDelta?: number; candidateScore?: number };
    assertEquals(parsed.scoreDelta, 0.05);
    assertEquals(parsed.candidateScore, 1.05);
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failure in tests.
    }
  }
});

Deno.test("SuccessCache falls back to direct write when rename fails", () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-success-cache-rename-fail-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const addSynapse = candidates.find((c) => c.change.type === "add-synapses");
  if (!addSynapse) throw new Error("Expected add-synapses candidate");

  const cacheDir = Deno.makeTempDirSync({
    prefix: "neat-ai-success-cache-rename-fail-",
  });

  const originalRename = Deno.renameSync;
  try {
    // Force the atomic rename path to fail so we execute the fallback.
    (Deno as unknown as { renameSync: typeof Deno.renameSync }).renameSync =
      () => {
        throw new Error("forced rename failure");
      };

    recordSuccessSync(
      cacheDir,
      addSynapse,
      {
        originalScore: 1,
        candidateScore: 1.01,
        scoreDelta: 0.01,
        originalError: 1,
        error: 0.99,
      },
      baseCreature,
    );

    const expectedDir = join(cacheDir, addSynapse.change.type);
    const expectedFilePath = join(
      expectedDir,
      `${buildCacheKey(addSynapse)}.json`,
    );
    const parsed = JSON.parse(
      Deno.readTextFileSync(expectedFilePath),
    ) as { scoreDelta?: number };
    assertEquals(parsed.scoreDelta, 0.01);

    const tmpFiles = Array.from(Deno.readDirSync(expectedDir))
      .filter((e) => e.isFile)
      .map((e) => e.name)
      .filter((name) => name.includes(".tmp-"));
    assertEquals(
      tmpFiles.length,
      0,
      "Expected temp files to be cleaned up after rename fallback",
    );
  } finally {
    (Deno as unknown as { renameSync: typeof Deno.renameSync }).renameSync =
      originalRename;
    closeRustLibrary();
    try {
      Deno.removeSync(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failure in tests.
    }
  }
});
