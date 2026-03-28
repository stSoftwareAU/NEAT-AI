import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import {
  buildCacheKey,
  isCandidateCachedSync,
  recordFailureSync,
} from "../../src/discovery/FailureCache.ts";
import {
  listSuccessEntriesSync,
  recordSuccessSync,
} from "../../src/discovery/SuccessCache.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  return Creature.fromJSON(base);
}

function makeCoordinatedCandidate(): CoordinatedStructuralCandidate {
  return {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      // Remove direct bypass.
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
      },
      // Re-weight the input->hidden path.
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-0",
        weight: 0.9,
      },
    ],
  };
}

Deno.test("FailureCache: coordinated-structural failures are recorded and then skipped", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-failure-cache-coordinated-",
  });

  try {
    const base = makeBaseCreature();
    const coordinated = makeCoordinatedCandidate();
    const mutated = applyCoordinatedStructuralCandidate(base, coordinated);

    const candidate: DiscoveryCandidate = {
      creature: mutated,
      change: {
        type: "coordinated-structural",
        description: "🧩 Coordinated structural (test)",
        expectedErrorReduction: coordinated.expectedCreatureScoreGain,
        coordinatedStructuralCandidate: coordinated,
      },
    };

    assertEquals(
      isCandidateCachedSync(cacheDir, candidate),
      false,
      "Precondition: candidate should not be cached",
    );

    recordFailureSync(
      cacheDir,
      candidate,
      {
        originalScore: 1,
        candidateScore: 0.99,
        scoreDelta: -0.01,
        originalError: 1,
        error: 1.01,
      },
      base,
    );

    assertEquals(
      isCandidateCachedSync(cacheDir, candidate),
      true,
      "Expected coordinated-structural candidate to be cached after failure",
    );
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failures in tests.
    }
  }
});

Deno.test("SuccessCache: coordinated-structural successes are recorded (replayable via rustRequest)", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-coordinated-",
  });

  try {
    const base = makeBaseCreature();
    const coordinated = makeCoordinatedCandidate();
    const mutated = applyCoordinatedStructuralCandidate(base, coordinated);

    const candidate: DiscoveryCandidate = {
      creature: mutated,
      change: {
        type: "coordinated-structural",
        description: "🧩 Coordinated structural (test)",
        expectedErrorReduction: coordinated.expectedCreatureScoreGain,
        coordinatedStructuralCandidate: coordinated,
      },
    };

    recordSuccessSync(
      cacheDir,
      candidate,
      {
        originalScore: 1,
        candidateScore: 1.01,
        scoreDelta: 0.01,
        originalError: 1,
        error: 0.99,
      },
      base,
    );

    const entries = listSuccessEntriesSync(cacheDir).filter((e) =>
      e.changeType === "coordinated-structural"
    );
    assertEquals(entries.length, 1);
    assertEquals(entries[0].key, buildCacheKey(candidate));

    const rr = entries[0].rustRequest as Record<string, unknown>;
    assertEquals(typeof rr.coordinatedStructuralCandidate, "object");

    // Verify the entry lands under the expected path too (same structure as failure cache).
    const expectedFile = join(
      cacheDir,
      candidate.change.type,
      `${buildCacheKey(candidate)}.json`,
    );
    const parsed = JSON.parse(await Deno.readTextFile(expectedFile)) as Record<
      string,
      unknown
    >;
    assertEquals(parsed.changeType, "coordinated-structural");
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failures in tests.
    }
  }
});
