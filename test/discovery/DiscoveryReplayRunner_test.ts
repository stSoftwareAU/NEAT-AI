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
    candidateCreatureExport: overrides.candidateCreatureExport,
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

  const deleted: Array<{ key: string; changeType: string }> = [];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1, e2, e3, alreadyApplied],
    deleteEntry: (_dir, entry) =>
      deleted.push({ key: entry.key, changeType: entry.changeType }),
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
  assertEquals(deleted, [{ key: "k3", changeType: "remove-synapse" }]);
  assertEquals(result.skippedAlreadyApplied, 1);

  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "combo-successful");
  assertEquals(result.improvement.score, 0.65);
});
