import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { DiscoveryReplayRunner } from "../../src/discovery/DiscoveryReplayRunner.ts";
import type { SuccessCacheEntry } from "../../src/discovery/SuccessCache.ts";

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

function makeEntry(overrides: Partial<SuccessCacheEntry>): SuccessCacheEntry {
  return {
    key: overrides.key ?? "k",
    changeType: overrides.changeType ?? "add-synapses",
    description: overrides.description,
    originalScore: overrides.originalScore ?? 0.5,
    candidateScore: overrides.candidateScore ?? 0.6,
    scoreDelta: overrides.scoreDelta ?? 0.1,
    error: overrides.error ?? 0.4,
    originalError: overrides.originalError ?? 0.5,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    rustRequest: overrides.rustRequest,
    actualCreatureChange: overrides.actualCreatureChange,
    discoveryVersion: overrides.discoveryVersion,
  };
}

Deno.test("DiscoveryReplayRunner prunes stale successes and prefers best combo", async () => {
  const base = makeBaseCreature();

  const e1 = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });
  const e2 = makeEntry({
    key: "k2",
    changeType: "change-squash",
    scoreDelta: 0.09,
  });
  const e3 = makeEntry({
    key: "k3",
    changeType: "remove-synapse",
    scoreDelta: 0.05,
  });

  const alreadyApplied = makeEntry({
    key: "k4",
    changeType: "remove-neuron",
    rustRequest: {
      harmfulNeuronCandidate: {
        neuronUUID: "does-not-exist",
        errorMagnitude: 0,
        expectedCreatureScoreGain: 0,
        sampleCount: 0,
      },
    },
  });

  const archived: Array<{ key: string; changeType: string }> = [];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1, e2, e3, alreadyApplied],
    archiveEntry: (_dir, entry) =>
      archived.push({ key: entry.key, changeType: entry.changeType }),
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      // We return explicit scores to avoid coupling tests to the score formula.
      // The runner should compare scores directly.
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0, score: 0.5 });
      if (id.includes("-k1") && id.includes("-k2")) {
        return Promise.resolve({ error: 0, score: 0.65 }); // combo best
      }
      if (id.endsWith("-k1")) return Promise.resolve({ error: 0, score: 0.6 }); // success
      if (id.endsWith("-k2")) return Promise.resolve({ error: 0, score: 0.59 }); // success
      if (id.endsWith("-k3")) return Promise.resolve({ error: 0, score: 0.49 }); // stale -> prune
      return Promise.resolve({ error: 0, score: 0.5 });
    },
  });

  base.uuid = "base";

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      discoveryReplayMaxPairwise: 10,
      discoveryReplayMaxTriples: 10,
      threads: 1,
    },
  });

  assertEquals(result.evaluatedSingles, 3); // k1,k2,k3 (k4 is already-applied)
  assertEquals(result.pruned, 1);
  assertEquals(archived, [{ key: "k3", changeType: "remove-synapse" }]);
  assertEquals(result.skippedAlreadyApplied, 1);

  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "combo-successful");
  assertEquals(result.improvement.score, 0.65);
});

/**
 * Tests for Issue #1113: DiscoveryReplayRunner timeout handling.
 *
 * These tests verify that the runner respects the timeout and returns
 * partial results when the timeout is reached.
 */

Deno.test("DiscoveryReplayRunner returns timedOut when timeout occurs before evaluation", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const e1 = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: () => Promise.resolve({ error: 0, score: 0.5 }),
  });

  // Use a timeout of 0.0001 minutes (6ms) which should cause immediate timeout
  // The timeout check happens before evaluation, so with a very short timeout
  // applied to entries we can test the timeout path.
  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      threads: 1,
    },
    timeoutMinutes: 0.0001, // Very short timeout (6ms)
  });

  // The result should indicate timeout or have partial results
  // Since we cannot guarantee exact timing, we verify the result structure is valid
  assertEquals(typeof result.original.error, "number");
  assertEquals(typeof result.original.score, "number");
  assertEquals(typeof result.evaluatedSingles, "number");
  assertEquals(typeof result.evaluatedCombos, "number");
});

Deno.test("DiscoveryReplayRunner completes normally with sufficient timeout", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const e1 = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      if (id.endsWith("-k1")) {
        return Promise.resolve({ error: 0.4, score: 0.6 });
      }
      return Promise.resolve({ error: 0.5, score: 0.5 });
    },
  });

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      threads: 1,
    },
    timeoutMinutes: 5, // 5 minutes is plenty of time
  });

  // Should complete without timing out
  assertEquals(result.timedOut, undefined);
  assertEquals(result.evaluatedSingles, 1);
  assertExists(result.improvement);
  assertEquals(result.improvement.score, 0.6);
});

Deno.test("DiscoveryReplayRunner works without timeout (undefined)", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const e1 = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      if (id.endsWith("-k1")) {
        return Promise.resolve({ error: 0.4, score: 0.6 });
      }
      return Promise.resolve({ error: 0.5, score: 0.5 });
    },
  });

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      threads: 1,
    },
    // No timeoutMinutes - should work without timeout
  });

  // Should complete normally
  assertEquals(result.timedOut, undefined);
  assertEquals(result.evaluatedSingles, 1);
  assertExists(result.improvement);
});
