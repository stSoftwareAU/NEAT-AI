import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { CandidateSynapse } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { buildDiscoveryCandidates } from "@discovery/DiscoveryCandidates.ts";
import { buildCacheKey, recordFailureSync } from "@discovery/FailureCache.ts";
import { recordSuccessSync } from "@discovery/SuccessCache.ts";
import { closeRustLibrary } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { makeForwardOnlyCreature as makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

/**
 * Issue #2814 — persisted cache `timestamp` fields must be ISO-8601 strings
 * parseable by `Temporal.Instant.from()`. This guards against regressions
 * back to `new Date().toISOString()` (which has only millisecond precision)
 * and confirms the wire format remains a plain string.
 */

function makeAddSynapseCandidate(): CandidateSynapse {
  return {
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 10,
    totalCount: 10,
    comment: "temporal-timestamp-test",
  };
}

Deno.test(
  "SuccessCache persists timestamp as Temporal.Instant-parseable ISO string",
  async () => {
    const baseCreature = makeBaseCreature();
    const discovery: DiscoverResult = {
      ID: "discovery-success-temporal-test",
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
      prefix: "neat-ai-success-temporal-",
    });
    try {
      const before = Temporal.Now.instant();
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
      const after = Temporal.Now.instant();

      const filePath = join(
        cacheDir,
        addSynapse.change.type,
        `${buildCacheKey(addSynapse)}.json`,
      );
      const parsed = JSON.parse(await Deno.readTextFile(filePath)) as {
        timestamp?: unknown;
      };
      assertEquals(typeof parsed.timestamp, "string");

      // Must be parseable as a Temporal.Instant.
      const instant = Temporal.Instant.from(parsed.timestamp as string);
      assert(instant instanceof Temporal.Instant);

      // Persisted instant must fall within the recording window (inclusive).
      assert(
        Temporal.Instant.compare(instant, before) >= 0,
        `timestamp ${parsed.timestamp} should be >= ${before.toString()}`,
      );
      assert(
        Temporal.Instant.compare(instant, after) <= 0,
        `timestamp ${parsed.timestamp} should be <= ${after.toString()}`,
      );
    } finally {
      closeRustLibrary();
      try {
        await Deno.remove(cacheDir, { recursive: true });
      } catch {
        // Ignore cleanup failure in tests.
      }
    }
  },
);

Deno.test(
  "FailureCache persists timestamp as Temporal.Instant-parseable ISO string",
  async () => {
    const baseCreature = makeBaseCreature();
    const discovery: DiscoverResult = {
      ID: "discovery-failure-temporal-test",
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
      prefix: "neat-ai-failure-temporal-",
    });
    try {
      const before = Temporal.Now.instant();
      recordFailureSync(cacheDir, addSynapse, {
        originalScore: 1,
        candidateScore: 0.9,
        scoreDelta: -0.1,
        originalError: 1,
        error: 1.1,
      });
      const after = Temporal.Now.instant();

      const filePath = join(
        cacheDir,
        addSynapse.change.type,
        `${buildCacheKey(addSynapse)}.json`,
      );
      const parsed = JSON.parse(await Deno.readTextFile(filePath)) as {
        timestamp?: unknown;
      };
      assertEquals(typeof parsed.timestamp, "string");

      const instant = Temporal.Instant.from(parsed.timestamp as string);
      assert(instant instanceof Temporal.Instant);

      assert(
        Temporal.Instant.compare(instant, before) >= 0,
        `timestamp ${parsed.timestamp} should be >= ${before.toString()}`,
      );
      assert(
        Temporal.Instant.compare(instant, after) <= 0,
        `timestamp ${parsed.timestamp} should be <= ${after.toString()}`,
      );
    } finally {
      closeRustLibrary();
      try {
        await Deno.remove(cacheDir, { recursive: true });
      } catch {
        // Ignore cleanup failure in tests.
      }
    }
  },
);
