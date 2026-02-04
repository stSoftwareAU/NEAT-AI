/**
 * Benchmark for Priority Discovery Queue (Issue #1299)
 *
 * Measures:
 * - Time to enqueue/dequeue operations with heap structure
 * - Priority calculation overhead
 * - Comparison between priority-based and simple delta sorting
 *
 * Run with: deno bench bench/PriorityDiscoveryQueue.ts
 */

import {
  calculatePriority,
  PriorityDiscoveryQueue,
} from "../src/discovery/PriorityDiscoveryQueue.ts";
import type { SuccessCacheEntry } from "../src/discovery/SuccessCache.ts";

function makeEntry(
  key: string,
  scoreDelta: number,
  changeType: string,
): SuccessCacheEntry {
  return {
    key,
    changeType,
    originalScore: 0.5,
    candidateScore: 0.5 + scoreDelta,
    scoreDelta,
    error: 0.4,
    originalError: 0.5,
    timestamp: new Date().toISOString(),
  };
}

function generateEntries(count: number): SuccessCacheEntry[] {
  const changeTypes = [
    "add-synapses",
    "add-neurons",
    "change-squash",
    "remove-low-impact",
  ];
  return Array.from({ length: count }, (_, i) => {
    const changeType = changeTypes[i % changeTypes.length];
    const scoreDelta = 0.01 + Math.random() * 0.2;
    return makeEntry(`entry-${i}`, scoreDelta, changeType);
  });
}

// Benchmark: Priority queue operations
Deno.bench("PriorityDiscoveryQueue: enqueue 1000 entries", () => {
  const queue = new PriorityDiscoveryQueue();
  const entries = generateEntries(1000);

  for (const entry of entries) {
    queue.enqueue(entry, entry.scoreDelta ?? 0);
  }
});

Deno.bench("PriorityDiscoveryQueue: enqueue and dequeue 1000 entries", () => {
  const queue = new PriorityDiscoveryQueue();
  const entries = generateEntries(1000);

  for (const entry of entries) {
    queue.enqueue(entry, entry.scoreDelta ?? 0);
  }

  while (!queue.isEmpty()) {
    queue.dequeue();
  }
});

Deno.bench("PriorityDiscoveryQueue: enqueue 100 then dequeue 50", () => {
  const queue = new PriorityDiscoveryQueue();
  const entries = generateEntries(100);

  for (const entry of entries) {
    queue.enqueue(entry, entry.scoreDelta ?? 0);
  }

  for (let i = 0; i < 50; i++) {
    queue.dequeue();
  }
});

// Benchmark: Priority calculation
Deno.bench("calculatePriority: without success rates", () => {
  const entry = makeEntry("test", 0.1, "add-synapses");
  calculatePriority(entry, {});
});

Deno.bench("calculatePriority: with success rates", () => {
  const entry = makeEntry("test", 0.1, "add-synapses");
  const successRates = new Map([
    ["add-synapses", 0.8],
    ["add-neurons", 0.6],
    ["change-squash", 0.5],
  ]);
  calculatePriority(entry, { successRates });
});

Deno.bench("calculatePriority: with success rates and failure counts", () => {
  const entry = makeEntry("test", 0.1, "add-synapses");
  const successRates = new Map([
    ["add-synapses", 0.8],
    ["add-neurons", 0.6],
    ["change-squash", 0.5],
  ]);
  const failureCounts = new Map([
    ["add-synapses", 2],
    ["add-neurons", 5],
  ]);
  calculatePriority(entry, { successRates, failureCounts });
});

// Benchmark: Comparison with simple Array.sort
Deno.bench("Array.sort: sort 1000 entries by scoreDelta", () => {
  const entries = generateEntries(1000);
  entries.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0));
});

Deno.bench("PriorityQueue vs Array.sort: process top 100 from 1000", {
  group: "top-100",
}, () => {
  const queue = new PriorityDiscoveryQueue();
  const entries = generateEntries(1000);
  const successRates = new Map([
    ["add-synapses", 0.8],
    ["add-neurons", 0.6],
    ["change-squash", 0.5],
    ["remove-low-impact", 0.7],
  ]);

  // Enqueue with calculated priorities
  for (const entry of entries) {
    const priority = calculatePriority(entry, { successRates });
    queue.enqueue(entry, priority);
  }

  // Dequeue top 100
  const top100: SuccessCacheEntry[] = [];
  for (let i = 0; i < 100 && !queue.isEmpty(); i++) {
    const item = queue.dequeue();
    if (item) top100.push(item.entry);
  }
});

Deno.bench("Array.sort: process top 100 from 1000", {
  group: "top-100",
  baseline: true,
}, () => {
  const entries = generateEntries(1000);
  const successRates = new Map([
    ["add-synapses", 0.8],
    ["add-neurons", 0.6],
    ["change-squash", 0.5],
    ["remove-low-impact", 0.7],
  ]);

  // Calculate priorities and sort
  const withPriorities = entries.map((entry) => ({
    entry,
    priority: calculatePriority(entry, { successRates }),
  }));
  withPriorities.sort((a, b) => b.priority - a.priority);

  // Take top 100
  const top100 = withPriorities.slice(0, 100).map((item) => item.entry);
  void top100;
});

// Benchmark: Update priority operation
Deno.bench(
  "PriorityDiscoveryQueue: update 100 priorities in 1000-item queue",
  () => {
    const queue = new PriorityDiscoveryQueue();
    const entries = generateEntries(1000);

    for (const entry of entries) {
      queue.enqueue(entry, entry.scoreDelta ?? 0);
    }

    // Update 100 random priorities
    for (let i = 0; i < 100; i++) {
      const key = `entry-${Math.floor(Math.random() * 1000)}`;
      const newPriority = Math.random() * 0.3;
      queue.updatePriority(key, newPriority);
    }
  },
);

// Benchmark: Realistic workload - simulate replay scenario
Deno.bench("Realistic: replay with 200 entries selecting top 20", () => {
  const entries = generateEntries(200);
  const queue = new PriorityDiscoveryQueue();
  const successRates = new Map([
    ["add-synapses", 0.75],
    ["add-neurons", 0.65],
    ["change-squash", 0.5],
    ["remove-low-impact", 0.8],
  ]);

  // Build priority queue
  for (const entry of entries) {
    const priority = calculatePriority(entry, { successRates });
    queue.enqueue(entry, priority);
  }

  // Select top 20 for evaluation
  const selected: SuccessCacheEntry[] = [];
  while (!queue.isEmpty() && selected.length < 20) {
    const item = queue.dequeue();
    if (item) selected.push(item.entry);
  }
});
