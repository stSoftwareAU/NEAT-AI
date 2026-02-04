import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";
import {
  calculatePriority,
  PriorityDiscoveryQueue,
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

Deno.test("PriorityDiscoveryQueue enqueue and dequeue in priority order", () => {
  const queue = new PriorityDiscoveryQueue();

  const lowPriority = makeEntry({ key: "low", scoreDelta: 0.05 });
  const highPriority = makeEntry({ key: "high", scoreDelta: 0.2 });
  const mediumPriority = makeEntry({ key: "medium", scoreDelta: 0.1 });

  queue.enqueue(lowPriority, 0.05);
  queue.enqueue(highPriority, 0.2);
  queue.enqueue(mediumPriority, 0.1);

  assertEquals(queue.size(), 3);

  // Should dequeue in priority order (highest first)
  const first = queue.dequeue();
  assertExists(first);
  assertEquals(first.entry.key, "high");
  assertEquals(first.priority, 0.2);

  const second = queue.dequeue();
  assertExists(second);
  assertEquals(second.entry.key, "medium");
  assertEquals(second.priority, 0.1);

  const third = queue.dequeue();
  assertExists(third);
  assertEquals(third.entry.key, "low");
  assertEquals(third.priority, 0.05);

  // Queue should be empty now
  assertEquals(queue.dequeue(), undefined);
  assertEquals(queue.size(), 0);
});

Deno.test("PriorityDiscoveryQueue peek returns highest priority without removing", () => {
  const queue = new PriorityDiscoveryQueue();

  const low = makeEntry({ key: "low", scoreDelta: 0.05 });
  const high = makeEntry({ key: "high", scoreDelta: 0.2 });

  queue.enqueue(low, 0.05);
  queue.enqueue(high, 0.2);

  // Peek should return highest priority
  const peeked = queue.peek();
  assertExists(peeked);
  assertEquals(peeked.entry.key, "high");

  // Size should not change after peek
  assertEquals(queue.size(), 2);

  // Peek again should return the same item
  const peeked2 = queue.peek();
  assertExists(peeked2);
  assertEquals(peeked2.entry.key, "high");
});

Deno.test("PriorityDiscoveryQueue updatePriority moves item to correct position", () => {
  const queue = new PriorityDiscoveryQueue();

  const a = makeEntry({ key: "a", scoreDelta: 0.1 });
  const b = makeEntry({ key: "b", scoreDelta: 0.2 });
  const c = makeEntry({ key: "c", scoreDelta: 0.15 });

  queue.enqueue(a, 0.1);
  queue.enqueue(b, 0.2);
  queue.enqueue(c, 0.15);

  // 'a' starts with low priority, but we update it to be highest
  queue.updatePriority("a", 0.5);

  // Now 'a' should come first
  const first = queue.dequeue();
  assertExists(first);
  assertEquals(first.entry.key, "a");
  assertEquals(first.priority, 0.5);

  // Then 'b' (priority 0.2)
  const second = queue.dequeue();
  assertExists(second);
  assertEquals(second.entry.key, "b");

  // Then 'c' (priority 0.15)
  const third = queue.dequeue();
  assertExists(third);
  assertEquals(third.entry.key, "c");
});

Deno.test("PriorityDiscoveryQueue deprioritise reduces priority", () => {
  const queue = new PriorityDiscoveryQueue();

  const a = makeEntry({ key: "a", scoreDelta: 0.2 });
  const b = makeEntry({ key: "b", scoreDelta: 0.15 });

  queue.enqueue(a, 0.2);
  queue.enqueue(b, 0.15);

  // Deprioritise 'a' with a multiplier of 0.1
  queue.deprioritise("a", 0.1);

  // Now 'b' should come first since 'a' has priority 0.02
  const first = queue.dequeue();
  assertExists(first);
  assertEquals(first.entry.key, "b");

  const second = queue.dequeue();
  assertExists(second);
  assertEquals(second.entry.key, "a");
  assertAlmostEquals(second.priority, 0.02, 1e-10);
});

Deno.test("PriorityDiscoveryQueue handles empty queue operations gracefully", () => {
  const queue = new PriorityDiscoveryQueue();

  assertEquals(queue.size(), 0);
  assertEquals(queue.isEmpty(), true);
  assertEquals(queue.dequeue(), undefined);
  assertEquals(queue.peek(), undefined);

  // updatePriority on non-existent key should not throw
  queue.updatePriority("nonexistent", 0.5);
  assertEquals(queue.size(), 0);
});

Deno.test("PriorityDiscoveryQueue clear removes all items", () => {
  const queue = new PriorityDiscoveryQueue();

  queue.enqueue(makeEntry({ key: "a" }), 0.1);
  queue.enqueue(makeEntry({ key: "b" }), 0.2);
  queue.enqueue(makeEntry({ key: "c" }), 0.15);

  assertEquals(queue.size(), 3);
  assertEquals(queue.isEmpty(), false);

  queue.clear();

  assertEquals(queue.size(), 0);
  assertEquals(queue.isEmpty(), true);
  assertEquals(queue.dequeue(), undefined);
});

Deno.test("PriorityDiscoveryQueue handles duplicate keys by replacing", () => {
  const queue = new PriorityDiscoveryQueue();

  const first = makeEntry({ key: "same", scoreDelta: 0.1 });
  const second = makeEntry({ key: "same", scoreDelta: 0.2 });

  queue.enqueue(first, 0.1);
  assertEquals(queue.size(), 1);

  // Enqueueing with same key should replace
  queue.enqueue(second, 0.3);
  assertEquals(queue.size(), 1);

  const dequeued = queue.dequeue();
  assertExists(dequeued);
  assertEquals(dequeued.entry.scoreDelta, 0.2);
  assertEquals(dequeued.priority, 0.3);
});

Deno.test("PriorityDiscoveryQueue toArray returns items in priority order", () => {
  const queue = new PriorityDiscoveryQueue();

  queue.enqueue(makeEntry({ key: "low" }), 0.1);
  queue.enqueue(makeEntry({ key: "high" }), 0.3);
  queue.enqueue(makeEntry({ key: "medium" }), 0.2);

  const items = queue.toArray();
  assertEquals(items.length, 3);
  assertEquals(items[0].entry.key, "high");
  assertEquals(items[1].entry.key, "medium");
  assertEquals(items[2].entry.key, "low");

  // Queue should still have all items
  assertEquals(queue.size(), 3);
});

Deno.test("PriorityDiscoveryQueue handles negative priorities", () => {
  const queue = new PriorityDiscoveryQueue();

  queue.enqueue(makeEntry({ key: "negative" }), -0.1);
  queue.enqueue(makeEntry({ key: "positive" }), 0.1);
  queue.enqueue(makeEntry({ key: "zero" }), 0);

  const first = queue.dequeue();
  assertExists(first);
  assertEquals(first.entry.key, "positive");

  const second = queue.dequeue();
  assertExists(second);
  assertEquals(second.entry.key, "zero");

  const third = queue.dequeue();
  assertExists(third);
  assertEquals(third.entry.key, "negative");
});

Deno.test("PriorityDiscoveryQueue handles equal priorities (FIFO within same priority)", () => {
  const queue = new PriorityDiscoveryQueue();

  queue.enqueue(makeEntry({ key: "a" }), 0.1);
  queue.enqueue(makeEntry({ key: "b" }), 0.1);
  queue.enqueue(makeEntry({ key: "c" }), 0.1);

  const first = queue.dequeue();
  assertExists(first);
  assertEquals(first.entry.key, "a");

  const second = queue.dequeue();
  assertExists(second);
  assertEquals(second.entry.key, "b");

  const third = queue.dequeue();
  assertExists(third);
  assertEquals(third.entry.key, "c");
});

// Tests for calculatePriority function

Deno.test("calculatePriority uses scoreDelta as base priority", () => {
  const entry = makeEntry({ scoreDelta: 0.15 });
  const priority = calculatePriority(entry, {});
  assertEquals(priority, 0.15);
});

Deno.test("calculatePriority applies successRateMultiplier", () => {
  const entry = makeEntry({ changeType: "add-synapses", scoreDelta: 0.1 });
  const successRates = new Map([["add-synapses", 0.8]]);

  const priority = calculatePriority(entry, { successRates });

  // Base priority 0.1 * (1 + successRate * weight)
  // With default weight of 0.5: 0.1 * (1 + 0.8 * 0.5) = 0.1 * 1.4 = 0.14
  assertAlmostEquals(priority, 0.14, 1e-10);
});

Deno.test("calculatePriority applies failure penalty", () => {
  const entry = makeEntry({ changeType: "add-neurons", scoreDelta: 0.1 });
  const failureCounts = new Map([["add-neurons", 5]]);

  const priority = calculatePriority(entry, { failureCounts });

  // Base priority with failure penalty: 0.1 * (1 - failureCount * penaltyWeight)
  // Default penaltyWeight is 0.05: 0.1 * (1 - 5 * 0.05) = 0.1 * 0.75 = 0.075
  assertAlmostEquals(priority, 0.075, 1e-10);
});

Deno.test("calculatePriority combines success rate and failure penalty", () => {
  const entry = makeEntry({ changeType: "change-squash", scoreDelta: 0.2 });
  const successRates = new Map([["change-squash", 0.6]]);
  const failureCounts = new Map([["change-squash", 2]]);

  const priority = calculatePriority(entry, { successRates, failureCounts });

  // successMultiplier: 1 + 0.6 * 0.5 = 1.3
  // failureMultiplier: 1 - 2 * 0.05 = 0.9
  // Combined: 0.2 * 1.3 * 0.9 = 0.234
  assertEquals(Number(priority.toFixed(3)), 0.234);
});

Deno.test("calculatePriority floors priority at minPriority", () => {
  const entry = makeEntry({ changeType: "add-neurons", scoreDelta: 0.01 });
  const failureCounts = new Map([["add-neurons", 100]]);

  const priority = calculatePriority(entry, {
    failureCounts,
    minPriority: 0.001,
  });

  // Even with massive failure penalty, priority should not go below minPriority
  assertEquals(priority, 0.001);
});

Deno.test("calculatePriority handles missing success rate gracefully", () => {
  const entry = makeEntry({ changeType: "unknown-type", scoreDelta: 0.1 });
  const successRates = new Map([["other-type", 0.8]]);

  const priority = calculatePriority(entry, { successRates });

  // Missing success rate means no boost, just base priority
  assertEquals(priority, 0.1);
});

Deno.test("calculatePriority handles undefined scoreDelta", () => {
  const entry = makeEntry({});
  // @ts-ignore - Testing runtime behaviour
  delete entry.scoreDelta;

  const priority = calculatePriority(entry, {});

  // Should fall back to 0 or a default
  assertEquals(priority, 0);
});
