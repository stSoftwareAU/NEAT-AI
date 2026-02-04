/**
 * Tests for PriorityDiscoveryQueue (Issue #1299)
 *
 * Priority queue implementation for discovery replay that orders candidates
 * by expected improvement, processing the most promising discoveries first.
 */
import {
  assert,
  assertEquals,
  assertGreater,
  assertGreaterOrEqual,
} from "@std/assert";
import {
  calculatePriority,
  dequeue,
  dequeueAll,
  enqueue,
  isEmpty,
  makeEmptyQueue,
  peek,
  size,
  updateSuccessRate,
} from "../../src/discovery/PriorityDiscoveryQueue.ts";
import type { SuccessCacheEntry } from "../../src/discovery/SuccessCache.ts";

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

// =============================================================================
// Priority Queue Basic Operations
// =============================================================================

Deno.test("PriorityDiscoveryQueue - makeEmptyQueue creates empty queue", () => {
  const queue = makeEmptyQueue();
  assertEquals(isEmpty(queue), true);
  assertEquals(size(queue), 0);
});

Deno.test("PriorityDiscoveryQueue - enqueue adds candidates with priority", () => {
  let queue = makeEmptyQueue();
  const entry = makeEntry({ key: "k1", scoreDelta: 0.1 });

  queue = enqueue(queue, entry, 10);

  assertEquals(isEmpty(queue), false);
  assertEquals(size(queue), 1);
});

Deno.test("PriorityDiscoveryQueue - dequeue returns highest priority first", () => {
  let queue = makeEmptyQueue();

  const lowPriority = makeEntry({ key: "low", scoreDelta: 0.01 });
  const highPriority = makeEntry({ key: "high", scoreDelta: 0.5 });
  const mediumPriority = makeEntry({ key: "med", scoreDelta: 0.1 });

  queue = enqueue(queue, lowPriority, 1);
  queue = enqueue(queue, highPriority, 100);
  queue = enqueue(queue, mediumPriority, 50);

  const [result1, queue1] = dequeue(queue);
  assertEquals(result1?.entry.key, "high");
  assertGreater(result1?.priority ?? 0, 50);

  const [result2, queue2] = dequeue(queue1);
  assertEquals(result2?.entry.key, "med");

  const [result3, queue3] = dequeue(queue2);
  assertEquals(result3?.entry.key, "low");

  const [result4] = dequeue(queue3);
  assertEquals(result4, undefined);
});

Deno.test("PriorityDiscoveryQueue - peek returns highest priority without removing", () => {
  let queue = makeEmptyQueue();
  const entry = makeEntry({ key: "k1", scoreDelta: 0.1 });
  queue = enqueue(queue, entry, 10);

  const peeked = peek(queue);
  assertEquals(peeked?.entry.key, "k1");
  assertEquals(size(queue), 1); // Queue unchanged
});

Deno.test("PriorityDiscoveryQueue - dequeueAll returns all candidates in priority order", () => {
  let queue = makeEmptyQueue();

  queue = enqueue(queue, makeEntry({ key: "c" }), 30);
  queue = enqueue(queue, makeEntry({ key: "a" }), 10);
  queue = enqueue(queue, makeEntry({ key: "b" }), 20);

  const [all, emptyQueue] = dequeueAll(queue);

  assertEquals(all.length, 3);
  assertEquals(all[0].entry.key, "c");
  assertEquals(all[1].entry.key, "b");
  assertEquals(all[2].entry.key, "a");
  assertEquals(isEmpty(emptyQueue), true);
});

// =============================================================================
// Priority Calculation
// =============================================================================

Deno.test("PriorityDiscoveryQueue - calculatePriority uses scoreDelta as primary factor", () => {
  const highDelta = makeEntry({ key: "high", scoreDelta: 0.5 });
  const lowDelta = makeEntry({ key: "low", scoreDelta: 0.01 });

  const highPriority = calculatePriority(highDelta);
  const lowPriority = calculatePriority(lowDelta);

  assertGreater(highPriority, lowPriority);
});

Deno.test("PriorityDiscoveryQueue - calculatePriority considers success rate", () => {
  const successRates = new Map<string, number>();
  successRates.set("add-synapses", 0.8); // 80% success rate
  successRates.set("remove-synapse", 0.2); // 20% success rate

  const highSuccess = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });
  const lowSuccess = makeEntry({
    key: "k2",
    changeType: "remove-synapse",
    scoreDelta: 0.1,
  });

  const highPriority = calculatePriority(highSuccess, { successRates });
  const lowPriority = calculatePriority(lowSuccess, { successRates });

  assertGreater(highPriority, lowPriority);
});

Deno.test("PriorityDiscoveryQueue - calculatePriority handles missing scoreDelta", () => {
  const entry = makeEntry({ key: "k1" });
  // @ts-ignore - Testing undefined scoreDelta
  entry.scoreDelta = undefined;

  const priority = calculatePriority(entry);
  assertGreaterOrEqual(priority, 0);
});

Deno.test("PriorityDiscoveryQueue - calculatePriority handles negative scoreDelta gracefully", () => {
  const entry = makeEntry({ key: "k1", scoreDelta: -0.1 });

  const priority = calculatePriority(entry);
  // Negative scoreDelta should still produce a valid priority (likely lower)
  assert(Number.isFinite(priority));
});

// =============================================================================
// Success Rate Tracking
// =============================================================================

Deno.test("PriorityDiscoveryQueue - updateSuccessRate tracks by changeType", () => {
  let queue = makeEmptyQueue();

  // Record some successes and failures
  queue = updateSuccessRate(queue, "add-synapses", true);
  queue = updateSuccessRate(queue, "add-synapses", true);
  queue = updateSuccessRate(queue, "add-synapses", false);
  queue = updateSuccessRate(queue, "remove-synapse", false);

  // add-synapses: 2 successes, 1 failure = 66.7%
  // remove-synapse: 0 successes, 1 failure = 0%

  const entry1 = makeEntry({ changeType: "add-synapses", scoreDelta: 0.1 });
  const entry2 = makeEntry({ changeType: "remove-synapse", scoreDelta: 0.1 });

  const p1 = calculatePriority(entry1, {
    successRates: queue.successRates,
  });
  const p2 = calculatePriority(entry2, {
    successRates: queue.successRates,
  });

  assertGreater(p1, p2);
});

Deno.test("PriorityDiscoveryQueue - updateSuccessRate uses default rate for unknown types", () => {
  const queue = makeEmptyQueue();

  const entry = makeEntry({ changeType: "unknown-type", scoreDelta: 0.1 });

  // Should not throw, should use a sensible default
  const priority = calculatePriority(entry, {
    successRates: queue.successRates,
  });
  assert(Number.isFinite(priority));
  assertGreater(priority, 0);
});

// =============================================================================
// Integration with DiscoveryReplayRunner patterns
// =============================================================================

Deno.test("PriorityDiscoveryQueue - prioritises high scoreDelta entries", () => {
  let queue = makeEmptyQueue();

  // Simulate entries with varying score deltas (like DiscoveryReplayRunner sees)
  const entries = [
    makeEntry({ key: "small", scoreDelta: 0.001 }),
    makeEntry({ key: "medium", scoreDelta: 0.05 }),
    makeEntry({ key: "large", scoreDelta: 0.15 }),
    makeEntry({ key: "huge", scoreDelta: 0.3 }),
  ];

  for (const entry of entries) {
    const priority = calculatePriority(entry);
    queue = enqueue(queue, entry, priority);
  }

  // Dequeue should give us largest scoreDelta first
  const [first] = dequeue(queue);
  assertEquals(first?.entry.key, "huge");
});

Deno.test("PriorityDiscoveryQueue - deprioritises repeatedly failing types", () => {
  let queue = makeEmptyQueue();

  // Simulate repeated failures for a particular type
  for (let i = 0; i < 10; i++) {
    queue = updateSuccessRate(queue, "remove-low-impact", false);
  }

  // And some successes for another type
  for (let i = 0; i < 5; i++) {
    queue = updateSuccessRate(queue, "add-neurons", true);
  }

  const failingEntry = makeEntry({
    key: "failing",
    changeType: "remove-low-impact",
    scoreDelta: 0.1,
  });
  const successEntry = makeEntry({
    key: "success",
    changeType: "add-neurons",
    scoreDelta: 0.1,
  });

  const failingPriority = calculatePriority(failingEntry, {
    successRates: queue.successRates,
  });
  const successPriority = calculatePriority(successEntry, {
    successRates: queue.successRates,
  });

  // Same scoreDelta, but add-neurons should have higher priority due to success rate
  assertGreater(successPriority, failingPriority);
});

Deno.test("PriorityDiscoveryQueue - maintains stable ordering for equal priorities", () => {
  let queue = makeEmptyQueue();

  // Add entries with same priority - order should be stable (FIFO for ties)
  queue = enqueue(queue, makeEntry({ key: "first" }), 50);
  queue = enqueue(queue, makeEntry({ key: "second" }), 50);
  queue = enqueue(queue, makeEntry({ key: "third" }), 50);

  const [all] = dequeueAll(queue);

  // With equal priorities, should maintain insertion order
  assertEquals(all[0].entry.key, "first");
  assertEquals(all[1].entry.key, "second");
  assertEquals(all[2].entry.key, "third");
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("PriorityDiscoveryQueue - handles empty queue operations gracefully", () => {
  const queue = makeEmptyQueue();

  const [result] = dequeue(queue);
  assertEquals(result, undefined);

  const peeked = peek(queue);
  assertEquals(peeked, undefined);

  const [all] = dequeueAll(queue);
  assertEquals(all.length, 0);
});

Deno.test("PriorityDiscoveryQueue - handles large number of entries", () => {
  let queue = makeEmptyQueue();

  // Add 1000 entries with random priorities
  const entries: Array<{ key: string; priority: number }> = [];
  for (let i = 0; i < 1000; i++) {
    const priority = Math.random() * 100;
    const key = `entry-${i}`;
    entries.push({ key, priority });
    queue = enqueue(queue, makeEntry({ key }), priority);
  }

  assertEquals(size(queue), 1000);

  // Verify they come out in priority order
  let lastPriority = Infinity;
  for (let i = 0; i < 1000; i++) {
    const [result, newQueue] = dequeue(queue);
    queue = newQueue;
    assert(result !== undefined);
    assertGreaterOrEqual(lastPriority, result.priority);
    lastPriority = result.priority;
  }

  assertEquals(isEmpty(queue), true);
});

Deno.test("PriorityDiscoveryQueue - immutable operations don't modify original", () => {
  const original = makeEmptyQueue();
  const entry = makeEntry({ key: "k1" });

  const afterEnqueue = enqueue(original, entry, 10);

  // Original should be unchanged
  assertEquals(isEmpty(original), true);
  assertEquals(size(original), 0);

  // New queue should have the entry
  assertEquals(isEmpty(afterEnqueue), false);
  assertEquals(size(afterEnqueue), 1);
});
