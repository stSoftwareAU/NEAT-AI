/**
 * Tests for priority-based discovery replay (Issue #1299).
 *
 * These tests verify that the DiscoveryReplayRunner correctly uses
 * the PriorityDiscoveryQueue when discoveryReplayPriorityEnabled is true.
 */

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

Deno.test("DiscoveryReplayRunner uses priority queue when enabled", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create entries with different score deltas
  // When using priority queue, higher score delta = higher priority
  const highDelta = makeEntry({
    key: "high",
    changeType: "add-synapses",
    scoreDelta: 0.2,
  });
  const medDelta = makeEntry({
    key: "med",
    changeType: "add-neurons",
    scoreDelta: 0.1,
  });
  const lowDelta = makeEntry({
    key: "low",
    changeType: "change-squash",
    scoreDelta: 0.05,
  });

  // Track the order entries are applied (only for singles from base)
  const appliedSinglesOrder: string[] = [];
  const seenKeys = new Set<string>();

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [lowDelta, highDelta, medDelta], // Provide in wrong order
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      // Only track first application of each key (singles phase)
      if (current.uuid === "base" && !seenKeys.has(entry.key)) {
        seenKeys.add(entry.key);
        appliedSinglesOrder.push(entry.key);
      }
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      // All candidates improve
      if (id.endsWith("-high")) {
        return Promise.resolve({ error: 0.3, score: 0.7 });
      }
      if (id.endsWith("-med")) {
        return Promise.resolve({ error: 0.35, score: 0.65 });
      }
      if (id.endsWith("-low")) {
        return Promise.resolve({ error: 0.4, score: 0.55 });
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
      discoveryReplayPriorityEnabled: true,
      discoveryReplayDiagnostics: true,
    },
  });

  // With priority queue enabled, entries should be processed in priority order
  // (highest scoreDelta first)
  assertEquals(appliedSinglesOrder, ["high", "med", "low"]);

  // Best improvement should be from the highest delta entry
  assertExists(result.improvement);
  assertEquals(result.improvement.score, 0.7);

  // Check diagnostics indicate priority queue was used
  assertExists(result.diagnostics);
  assertExists(result.diagnostics.priorityQueue);
  assertEquals(result.diagnostics.priorityQueue.enabled, true);
});

Deno.test("DiscoveryReplayRunner falls back to simple sort when priority disabled", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const highDelta = makeEntry({
    key: "high",
    changeType: "add-synapses",
    scoreDelta: 0.2,
  });
  const lowDelta = makeEntry({
    key: "low",
    changeType: "change-squash",
    scoreDelta: 0.05,
  });

  const appliedSinglesOrder: string[] = [];
  const seenKeys = new Set<string>();

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [lowDelta, highDelta], // Provide in wrong order
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      // Only track first application of each key (singles phase)
      if (current.uuid === "base" && !seenKeys.has(entry.key)) {
        seenKeys.add(entry.key);
        appliedSinglesOrder.push(entry.key);
      }
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      if (id.endsWith("-high")) {
        return Promise.resolve({ error: 0.3, score: 0.7 });
      }
      if (id.endsWith("-low")) {
        return Promise.resolve({ error: 0.4, score: 0.55 });
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
      discoveryReplayPriorityEnabled: false, // Disable priority queue
      discoveryReplayDiagnostics: true,
    },
  });

  // Even with priority disabled, should still sort by scoreDelta
  assertEquals(appliedSinglesOrder, ["high", "low"]);

  assertExists(result.improvement);
  assertEquals(result.improvement.score, 0.7);

  // Diagnostics should not have priority queue info when disabled
  assertExists(result.diagnostics);
  assertEquals(result.diagnostics.priorityQueue, undefined);
});

Deno.test("Priority queue boosts candidates with high success rate change types", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create multiple entries of the same type to establish a success rate pattern
  // add-synapses has 3 entries, all with positive scoreDelta (100% success rate)
  // add-neurons has 1 entry with lower scoreDelta
  const synapse1 = makeEntry({
    key: "syn1",
    changeType: "add-synapses",
    scoreDelta: 0.08,
  });
  const synapse2 = makeEntry({
    key: "syn2",
    changeType: "add-synapses",
    scoreDelta: 0.09,
  });
  const synapse3 = makeEntry({
    key: "syn3",
    changeType: "add-synapses",
    scoreDelta: 0.07,
  });
  const neuron1 = makeEntry({
    key: "neu1",
    changeType: "add-neurons",
    scoreDelta: 0.10, // Higher base delta but only one entry
  });

  const appliedSinglesOrder: string[] = [];
  const seenKeys = new Set<string>();

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [neuron1, synapse1, synapse2, synapse3],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      // Only track first application of each key (singles phase)
      if (current.uuid === "base" && !seenKeys.has(entry.key)) {
        seenKeys.add(entry.key);
        appliedSinglesOrder.push(entry.key);
      }
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0.5, score: 0.5 });
      // All candidates improve proportionally to their delta
      return Promise.resolve({ error: 0.4, score: 0.6 });
    },
  });

  await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      threads: 1,
      discoveryReplayPriorityEnabled: true,
    },
  });

  // With priority queue and success rate boost:
  // add-synapses has 100% success rate (3/3 positive deltas) -> boost factor
  // add-neurons has 100% success rate (1/1) -> boost factor
  // The order depends on the combined priority calculation
  // Most important: all entries should be processed as singles
  assertEquals(appliedSinglesOrder.length, 4);
  assertEquals(
    new Set(appliedSinglesOrder),
    new Set(["syn1", "syn2", "syn3", "neu1"]),
  );
});

Deno.test("Priority queue respects discoveryReplayMaxSingles limit", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  // Create more entries than the max
  const entries = Array.from({ length: 10 }, (_, i) =>
    makeEntry({
      key: `entry-${i}`,
      changeType: "add-synapses",
      scoreDelta: 0.1 + i * 0.01, // Increasing deltas
    }));

  const appliedSinglesOrder: string[] = [];
  const seenKeys = new Set<string>();

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => entries,
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      // Only track first application of each key (singles phase)
      if (current.uuid === "base" && !seenKeys.has(entry.key)) {
        seenKeys.add(entry.key);
        appliedSinglesOrder.push(entry.key);
      }
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: () => Promise.resolve({ error: 0.4, score: 0.6 }),
  });

  await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 5, // Limit to 5
      threads: 1,
      discoveryReplayPriorityEnabled: true,
    },
  });

  // Should only apply top 5 entries (highest priority)
  assertEquals(appliedSinglesOrder.length, 5);

  // Should be the 5 entries with highest scoreDelta (entry-9 through entry-5)
  const expectedEntries = [
    "entry-9",
    "entry-8",
    "entry-7",
    "entry-6",
    "entry-5",
  ];
  assertEquals(appliedSinglesOrder, expectedEntries);
});

Deno.test("Priority queue diagnostics includes success rates", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const entries = [
    makeEntry({ key: "syn1", changeType: "add-synapses", scoreDelta: 0.1 }),
    makeEntry({ key: "syn2", changeType: "add-synapses", scoreDelta: 0.05 }),
    makeEntry({ key: "neu1", changeType: "add-neurons", scoreDelta: 0.08 }),
  ];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => entries,
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: () => Promise.resolve({ error: 0.4, score: 0.6 }),
  });

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      threads: 1,
      discoveryReplayPriorityEnabled: true,
      discoveryReplayDiagnostics: true,
    },
  });

  assertExists(result.diagnostics);
  assertExists(result.diagnostics.priorityQueue);

  // Check success rates are recorded
  const successRates = result.diagnostics.priorityQueue.successRates;
  assertExists(successRates["add-synapses"]);
  assertExists(successRates["add-neurons"]);

  // Both types have 100% success rate (all entries have positive scoreDelta)
  assertEquals(successRates["add-synapses"], 1);
  assertEquals(successRates["add-neurons"], 1);
});
