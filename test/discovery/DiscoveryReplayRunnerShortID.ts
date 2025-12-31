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

Deno.test("DiscoveryReplayRunner: verifiedImprovement shortens creature uuid to last 8 chars", async () => {
  const base = makeBaseCreature();
  base.uuid = "01234567-89ab-cdef-0123-456789abcdef";
  base.tags = [
    { name: "score", value: "1" },
    { name: "error", value: "0.1" },
  ];

  const entry = makeEntry({
    key: "a",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [entry],
    applyEntry: (current, e) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid}-${e.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === base.uuid) return Promise.resolve({ error: 0.1, score: 1.0 });
      if (id.endsWith("-a")) return Promise.resolve({ error: 0.1, score: 1.1 });
      return Promise.resolve({ error: 0.1, score: 1.0 });
    },
  });

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      threads: 1,
      discoveryReplayVerifyScores: true,
    },
  });

  assertExists(result.verifiedImprovement);
  assertEquals(
    result.verifiedImprovement.message.includes("for 89abcdef:"),
    true,
  );
});
