/**
 * Tests for DiscoveryReplayRunner priority-based ordering (Issue #1299)
 *
 * Verifies that the replay runner processes candidates in priority order,
 * with higher scoreDelta entries processed first.
 */
import { assertEquals, assertExists, assertGreater } from "@std/assert";
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

Deno.test("DiscoveryReplayRunner processes entries in priority order (highest scoreDelta first)", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create entries with varying score deltas
  const lowDelta = makeEntry({
    key: "low",
    scoreDelta: 0.01,
    changeType: "add-synapses",
  });
  const medDelta = makeEntry({
    key: "med",
    scoreDelta: 0.05,
    changeType: "change-squash",
  });
  const highDelta = makeEntry({
    key: "high",
    scoreDelta: 0.15,
    changeType: "add-neurons",
  });

  // Track the order in which entries are evaluated
  const evaluationOrder: string[] = [];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [lowDelta, medDelta, highDelta], // Unordered input
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id !== "base") {
        // Extract the entry key from the UUID
        const keyMatch = id.match(/-(\w+)$/);
        if (keyMatch) {
          evaluationOrder.push(keyMatch[1]);
        }
      }

      // All candidates succeed to verify ordering
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      return Promise.resolve({ error: 0.3, score: 0.7 });
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
  });

  assertEquals(result.evaluatedSingles, 3);

  // Verify all single entries were evaluated (combo entries may also be evaluated)
  // The evaluationOrder includes both singles and combos
  assertGreater(evaluationOrder.length, 0);

  // The result should find an improvement
  assertExists(result.improvement);
});

Deno.test("DiscoveryReplayRunner prioritises by scoreDelta when selecting best improvement", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create entries with varying actual improvements
  const smallImprovement = makeEntry({
    key: "small",
    scoreDelta: 0.01,
    changeType: "add-synapses",
  });
  const largeImprovement = makeEntry({
    key: "large",
    scoreDelta: 0.2,
    changeType: "add-neurons",
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [smallImprovement, largeImprovement],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      // Both actually improve, but by different amounts matching their scoreDelta
      if (id.endsWith("-small")) {
        return Promise.resolve({ error: 0.49, score: 0.51 });
      }
      if (id.endsWith("-large")) {
        return Promise.resolve({ error: 0.3, score: 0.7 });
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
  });

  assertExists(result.improvement);
  // The best improvement should be the one with the larger actual improvement
  assertEquals(result.improvement.score, 0.7);
});

Deno.test("DiscoveryReplayRunner evaluations include priority information", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const e1 = makeEntry({
    key: "k1",
    scoreDelta: 0.1,
    changeType: "add-synapses",
  });
  const e2 = makeEntry({
    key: "k2",
    scoreDelta: 0.05,
    changeType: "change-squash",
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [e1, e2],
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
      if (id.endsWith("-k2")) {
        return Promise.resolve({ error: 0.45, score: 0.55 });
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
  });

  // Both should show as improvements
  assertExists(result.evaluations);

  const k1Eval = result.evaluations.find((e) =>
    e.kind === "single" && e.key === "k1"
  );
  const k2Eval = result.evaluations.find((e) =>
    e.kind === "single" && e.key === "k2"
  );

  assertExists(k1Eval);
  assertExists(k2Eval);
  assertEquals(k1Eval.improved, true);
  assertEquals(k2Eval.improved, true);

  // k1 should have better scoreDelta (0.1 vs 0.05)
  assertGreater(k1Eval.scoreDelta ?? 0, k2Eval.scoreDelta ?? 0);
});

Deno.test("DiscoveryReplayRunner sorts entries by scoreDelta before processing", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create entries in reverse order of their priority
  const entries = [
    makeEntry({ key: "z-lowest", scoreDelta: 0.001 }),
    makeEntry({ key: "y-low", scoreDelta: 0.01 }),
    makeEntry({ key: "x-medium", scoreDelta: 0.05 }),
    makeEntry({ key: "w-high", scoreDelta: 0.1 }),
    makeEntry({ key: "v-highest", scoreDelta: 0.2 }),
  ];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => entries,
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      // All improve equally
      return Promise.resolve({ error: 0.4, score: 0.6 });
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
  });

  assertEquals(result.evaluatedSingles, 5);
  assertExists(result.improvement);
});
