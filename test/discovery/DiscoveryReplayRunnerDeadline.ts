/**
 * Tests for Issue #2901: DiscoveryReplayRunner absolute-deadline and
 * cooperative-abort handling.
 *
 * The runner must honour an absolute `deadlineTS` (immune to worker-queue /
 * start delays) and a cooperative abort `signal`. When either fires, the
 * runner stops at its next candidate-boundary check and performs no further
 * data-directory reads (no candidate evaluation).
 *
 * These are behavioural "what" tests using injected timestamps and a
 * pre-aborted signal — no elapsed-time measurement (policy from #2888).
 */
import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { DiscoveryReplayRunner } from "@discovery/DiscoveryReplayRunner.ts";
import { DISCOVERY_WIRE_SCHEMA_VERSION } from "@discovery/DiscoveryWireFormat.ts";
import type { SuccessCacheEntry } from "@discovery/SuccessCache.ts";
import { makeForwardOnlyCreature as makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

function makeEntry(overrides: Partial<SuccessCacheEntry>): SuccessCacheEntry {
  return {
    wireSchemaVersion: overrides.wireSchemaVersion ??
      DISCOVERY_WIRE_SCHEMA_VERSION,
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

const OPTIONS = {
  discoverySuccessCacheDir: "/tmp/does-not-matter",
  costOfGrowth: 0,
  discoveryReplayMaxSingles: 10,
  threads: 1,
};

Deno.test("DiscoveryReplayRunner honours an absolute deadline earlier than now + timeoutMinutes", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  let evaluateCalls = 0;
  let listCalls = 0;

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => {
      listCalls++;
      return [makeEntry({ key: "k1" })];
    },
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: () => {
      evaluateCalls++;
      return Promise.resolve({ error: 0, score: 0.5 });
    },
  });

  // timeoutMinutes is generous (10m) but the absolute deadline is in the past
  // (1ms after epoch). The earlier deadline must win, so the runner times out
  // before evaluating any candidate.
  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: OPTIONS,
    timeoutMinutes: 10,
    deadlineTS: 1,
  });

  assertEquals(
    result.timedOut,
    true,
    "Absolute deadline should win over timeoutMinutes",
  );
  assertEquals(
    result.evaluatedSingles,
    0,
    "No singles evaluated after timeout",
  );
  assertEquals(
    evaluateCalls,
    0,
    "No candidate evaluation after the deadline boundary",
  );
  assertEquals(
    listCalls,
    1,
    "Cache listed once before the first boundary check",
  );
});

Deno.test("DiscoveryReplayRunner stops at the candidate boundary when the abort signal is already aborted", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  let evaluateCalls = 0;

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [makeEntry({ key: "k1" })],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: () => {
      evaluateCalls++;
      return Promise.resolve({ error: 0, score: 0.5 });
    },
  });

  const controller = new AbortController();
  controller.abort();

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: OPTIONS,
    signal: controller.signal,
  });

  assertEquals(result.timedOut, true, "Aborted signal should stop the replay");
  assertEquals(result.evaluatedSingles, 0, "No singles evaluated once aborted");
  assertEquals(
    evaluateCalls,
    0,
    "Aborted replay performs no candidate evaluation",
  );
});

Deno.test("DiscoveryReplayRunner completes normally when the absolute deadline is far in the future", async () => {
  const base = makeBaseCreature();
  base.uuid = "base";

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [makeEntry({ key: "k1" })],
    archiveEntry: () => {},
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id.endsWith("-k1")) {
        return Promise.resolve({ error: 0.4, score: 0.6 });
      }
      return Promise.resolve({ error: 0.5, score: 0.5 });
    },
  });

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: OPTIONS,
    deadlineTS: Number.MAX_SAFE_INTEGER,
  });

  assertEquals(
    result.timedOut,
    undefined,
    "Far-future deadline should not time out",
  );
  assertEquals(result.evaluatedSingles, 1);
});
