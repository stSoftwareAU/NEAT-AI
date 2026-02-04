import { assert, assertEquals, assertExists } from "@std/assert";
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

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

Deno.test("DiscoveryReplayRunner: detects baseline score drift when verification enabled", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [
    { name: "score", value: "0.9" },
    { name: "error", value: "0.05" },
    { name: "source", value: "unit-test" },
  ];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [],
    evaluateError: (c) => {
      assertEquals(c.uuid, "base");
      return Promise.resolve({ error: 0.2, score: 0.5 });
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

  assertExists(result.baselineRescore);
  assertEquals(result.baselineRescore.claimedScore, 0.9);
  assertEquals(result.baselineRescore.actualScore, 0.5);
  assertEquals(result.baselineRescore.actualError, 0.2);
  assertEquals(result.baselineRescore.changed, true);
  assert(result.baselineRescore.reason.length > 0);
});

Deno.test("DiscoveryReplayRunner: baselineRescore includes a helpful reason when no claimed score tag exists", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [{ name: "error", value: "0.2" }];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [],
    evaluateError: (c) => {
      assertEquals(c.uuid, "base");
      return Promise.resolve({ error: 0.2, score: 0.5 });
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

  assertExists(result.baselineRescore);
  assertEquals(result.baselineRescore.claimedScore, undefined);
  assertEquals(result.baselineRescore.actualScore, 0.5);
  assertEquals(result.baselineRescore.actualError, 0.2);
  assertEquals(result.baselineRescore.changed, false);
  assert(result.baselineRescore.reason.startsWith("🦘 "));
});

Deno.test("DiscoveryReplayRunner: rejects stale 'better by cache metadata' candidates when verification enabled", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [
    { name: "score", value: "0.5" },
    { name: "error", value: "0.2" },
  ];

  const stale = makeEntry({
    key: "stale",
    changeType: "add-synapses",
    candidateScore: 999, // looks incredible in cached metadata
    scoreDelta: 999,
  });

  const archived: Array<{ key: string; changeType: string }> = [];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [stale],
    archiveEntry: (_dir, entry) =>
      archived.push({ key: entry.key, changeType: entry.changeType }),
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.2, score: 0.5 });
      if (id.endsWith("-stale")) {
        return Promise.resolve({ error: 0.21, score: 0.49 });
      }
      return Promise.resolve({ error: 0.2, score: 0.5 });
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

  assertEquals(result.pruned, 1);
  assertEquals(archived, [{ key: "stale", changeType: "add-synapses" }]);
  assertEquals(result.improvement, undefined);
  assertEquals(result.verifiedImprovement, undefined);
});

Deno.test("DiscoveryReplayRunner: considers all-removals combo as a separate outcome", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [
    { name: "score", value: "1" },
    { name: "error", value: "0.1" },
  ];

  const remove1 = makeEntry({
    key: "r1",
    changeType: "remove-synapse",
    scoreDelta: 0.05,
  });
  const remove2 = makeEntry({
    key: "r2",
    changeType: "remove-neuron",
    scoreDelta: 0.04,
  });
  const add1 = makeEntry({
    key: "a1",
    changeType: "add-synapses",
    scoreDelta: 0.03,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [remove1, remove2, add1],
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.1, score: 1.0 });

      // Singles: all succeed.
      if (id.endsWith("-r1")) {
        return Promise.resolve({ error: 0.1, score: 1.05 });
      }
      if (id.endsWith("-r2")) {
        return Promise.resolve({ error: 0.1, score: 1.04 });
      }
      if (id.endsWith("-a1")) {
        return Promise.resolve({ error: 0.1, score: 1.03 });
      }

      // Combos:
      // - removals-only combo best
      if (id.includes("-r1") && id.includes("-r2") && !id.includes("-a1")) {
        return Promise.resolve({ error: 0.1, score: 1.06 });
      }
      // - all-successful combo slightly worse
      if (id.includes("-r1") && id.includes("-r2") && id.includes("-a1")) {
        return Promise.resolve({ error: 0.1, score: 1.055 });
      }

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
      discoveryReplayMaxSingles: 10,
      discoveryReplayMaxPairwise: 10,
      discoveryReplayMaxTriples: 10,
    },
  });

  // We expect two combo evaluations:
  // - all-successful combo (r1+r2+a1)
  // - removals-only combo (r1+r2)
  assertEquals(result.evaluatedCombos, 2);
  assertExists(result.evaluations);
  const comboDescriptions = result.evaluations
    .filter((e) => e.kind === "combo")
    .map((e) => e.description ?? "");
  assert(comboDescriptions.some((d) => d.includes("cached pruning")));
});

Deno.test("DiscoveryReplayRunner: concurrency does not change which verified improvement is selected", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [
    { name: "score", value: "1" },
    { name: "error", value: "0.1" },
  ];

  const a = makeEntry({
    key: "a",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });
  const b = makeEntry({
    key: "b",
    changeType: "change-squash",
    scoreDelta: 0.1,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [a, b],
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid}-${entry.key}`;
      clone.tags = [{ name: "key", value: entry.key }];
      return clone;
    },
    evaluateError: async (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return { error: 0.1, score: 1.0 };
      if (id.endsWith("-a")) {
        // Slower on purpose so concurrency changes completion order.
        await delay(20);
        return { error: 0.1, score: 1.1 };
      }
      if (id.endsWith("-b")) {
        await delay(1);
        return { error: 0.1, score: 1.1 };
      }
      return { error: 0.1, score: 1.0 };
    },
  });

  const run = (discoveryReplayConcurrency: number) =>
    runner.replayDir({
      creature: base,
      dataDir: "/tmp/does-not-matter",
      options: {
        discoverySuccessCacheDir: "/tmp/does-not-matter",
        costOfGrowth: 0,
        threads: 1,
        discoveryReplayVerifyScores: true,
        discoveryReplayConcurrency,
      },
    });

  const r1 = await run(1);
  const r2 = await run(2);

  assertExists(r1.verifiedImprovement);
  assertExists(r2.verifiedImprovement);
  assertEquals(r1.verifiedImprovement.improved, true);
  assertEquals(r2.verifiedImprovement.improved, true);
  assertEquals(
    r1.verifiedImprovement.scoreDelta,
    r2.verifiedImprovement.scoreDelta,
  );
  assertEquals(
    r1.verifiedImprovement.creature.tags?.[0]?.value,
    r2.verifiedImprovement.creature.tags?.[0]?.value,
  );
});

Deno.test("DiscoveryReplayRunner: returns timing diagnostics when enabled", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";
  base.tags = [{ name: "score", value: "0.5" }];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [],
    evaluateError: (c) => {
      assertEquals(c.uuid, "base");
      return Promise.resolve({ error: 0.2, score: 0.5 });
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
      discoveryReplayDiagnostics: true,
    },
  });

  assertExists(result.diagnostics);
  assertExists(result.diagnostics.timingsMS.total);
  assertExists(result.diagnostics.timingsMS.listEntries);
  // With priority queue enabled (default), priorityQueueBuild is used instead of sortEntries
  // Either one should be present depending on discoveryReplayPriorityEnabled setting
  const hasSortTiming =
    result.diagnostics.timingsMS.sortEntries !== undefined ||
    result.diagnostics.timingsMS.priorityQueueBuild !== undefined;
  assertEquals(
    hasSortTiming,
    true,
    "Expected either sortEntries or priorityQueueBuild timing",
  );
  assertExists(result.diagnostics.timingsMS.applySingles);
  assertExists(result.diagnostics.timingsMS.evaluateBaselineAndSingles);
  assertExists(result.diagnostics.timingsMS.selectBest);
  assertEquals(result.diagnostics.counts.entriesLoaded, 0);
  assertEquals(result.diagnostics.counts.singlesEvaluated, 0);
});
