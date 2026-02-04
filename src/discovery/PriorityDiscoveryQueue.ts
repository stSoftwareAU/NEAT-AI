/**
 * Priority Discovery Queue Module (Issue #1299)
 *
 * Implements a priority queue for discovery replay that orders candidates by
 * expected improvement, processing the most promising discoveries first.
 *
 * The queue uses a max-heap structure for O(log n) enqueue/dequeue operations
 * and maintains insertion order for entries with equal priorities (stable sort).
 *
 * Priority is calculated based on:
 * - Score delta from original discovery (primary factor)
 * - Historical success rate for the candidate's change type
 * - Improvement magnitude
 *
 * This module uses an immutable/functional style - all operations return new
 * queue instances rather than modifying the original.
 */

import type { SuccessCacheEntry } from "./SuccessCache.ts";

/** A candidate with its calculated priority and expected improvement. */
export interface PrioritisedCandidate {
  entry: SuccessCacheEntry;
  priority: number;
  expectedImprovement: number;
  /** Insertion order for stable sorting when priorities are equal. */
  insertionOrder: number;
}

/** Success rate tracking for each change type. */
export interface SuccessRateStats {
  successes: number;
  failures: number;
}

/**
 * Priority queue for discovery replay candidates.
 *
 * Uses an immutable design - all operations return new queue instances.
 */
export interface PriorityDiscoveryQueue {
  /** Heap array storing prioritised candidates. */
  readonly heap: readonly PrioritisedCandidate[];
  /** Success rate tracking per change type. */
  readonly successRates: ReadonlyMap<string, number>;
  /** Success/failure counts per change type for updating rates. */
  readonly successStats: ReadonlyMap<string, SuccessRateStats>;
  /** Counter for maintaining insertion order. */
  readonly insertionCounter: number;
}

/** Options for calculating priority. */
export interface CalculatePriorityOptions {
  /** Success rates by change type (0.0 to 1.0). */
  successRates?: ReadonlyMap<string, number>;
  /** Weight for score delta factor (default: 0.7). */
  scoreDeltaWeight?: number;
  /** Weight for success rate factor (default: 0.3). */
  successRateWeight?: number;
}

/** Default success rate for unknown change types. */
const DEFAULT_SUCCESS_RATE = 0.5;

/** Weight constants for priority calculation. */
const DEFAULT_SCORE_DELTA_WEIGHT = 0.7;
const DEFAULT_SUCCESS_RATE_WEIGHT = 0.3;

/**
 * Creates an empty priority queue.
 */
export function makeEmptyQueue(): PriorityDiscoveryQueue {
  return {
    heap: [],
    successRates: new Map(),
    successStats: new Map(),
    insertionCounter: 0,
  };
}

/**
 * Checks if the queue is empty.
 */
export function isEmpty(queue: PriorityDiscoveryQueue): boolean {
  return queue.heap.length === 0;
}

/**
 * Returns the number of candidates in the queue.
 */
export function size(queue: PriorityDiscoveryQueue): number {
  return queue.heap.length;
}

/**
 * Calculates the priority for a candidate based on its score delta and
 * historical success rate.
 *
 * Priority formula:
 *   priority = (scoreDelta * scoreDeltaWeight) + (successRate * successRateWeight)
 *
 * The score delta is normalised to ensure it contributes meaningfully even for
 * small improvements. Higher score deltas and higher success rates result in
 * higher priority.
 *
 * @param entry - The success cache entry to calculate priority for
 * @param options - Optional configuration for priority calculation
 * @returns A priority value (higher = more urgent)
 */
export function calculatePriority(
  entry: SuccessCacheEntry,
  options: CalculatePriorityOptions = {},
): number {
  const scoreDeltaWeight = options.scoreDeltaWeight ??
    DEFAULT_SCORE_DELTA_WEIGHT;
  const successRateWeight = options.successRateWeight ??
    DEFAULT_SUCCESS_RATE_WEIGHT;
  const successRates = options.successRates;

  // Score delta component: use the raw scoreDelta, scaled by 100 to make small
  // improvements more significant. Negative deltas result in negative contribution.
  const scoreDelta = typeof entry.scoreDelta === "number" &&
      Number.isFinite(entry.scoreDelta)
    ? entry.scoreDelta
    : 0;

  // Normalise score delta: scale to make typical values (0.001 - 0.5) more distinct
  // Using a log scale would compress the range too much, so we use linear scaling.
  const normalisedScoreDelta = scoreDelta * 100;

  // Success rate component: look up the historical success rate for this change type
  const successRate = successRates?.get(entry.changeType) ??
    DEFAULT_SUCCESS_RATE;

  // Calculate weighted priority
  const priority = (normalisedScoreDelta * scoreDeltaWeight) +
    (successRate * 100 * successRateWeight);

  return priority;
}

/**
 * Enqueues a candidate with the given priority.
 *
 * @param queue - The current queue
 * @param entry - The success cache entry to enqueue
 * @param priority - The priority value for this entry
 * @returns A new queue with the entry added
 */
export function enqueue(
  queue: PriorityDiscoveryQueue,
  entry: SuccessCacheEntry,
  priority: number,
): PriorityDiscoveryQueue {
  const candidate: PrioritisedCandidate = {
    entry,
    priority,
    expectedImprovement: entry.scoreDelta ?? 0,
    insertionOrder: queue.insertionCounter,
  };

  // Create a mutable copy of the heap for the heapify operation
  const newHeap = [...queue.heap, candidate];

  // Bubble up: maintain heap property
  let index = newHeap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareCandidates(newHeap[index], newHeap[parentIndex]) <= 0) {
      break;
    }
    // Swap with parent
    [newHeap[index], newHeap[parentIndex]] = [
      newHeap[parentIndex],
      newHeap[index],
    ];
    index = parentIndex;
  }

  return {
    ...queue,
    heap: newHeap,
    insertionCounter: queue.insertionCounter + 1,
  };
}

/**
 * Removes and returns the highest priority candidate.
 *
 * @param queue - The current queue
 * @returns A tuple of [candidate, newQueue] or [undefined, queue] if empty
 */
export function dequeue(
  queue: PriorityDiscoveryQueue,
): [PrioritisedCandidate | undefined, PriorityDiscoveryQueue] {
  if (queue.heap.length === 0) {
    return [undefined, queue];
  }

  const top = queue.heap[0];

  if (queue.heap.length === 1) {
    return [top, { ...queue, heap: [] }];
  }

  // Create a mutable copy of the heap
  const newHeap = [...queue.heap];

  // Move last element to root and remove it from end
  newHeap[0] = newHeap[newHeap.length - 1];
  newHeap.pop();

  // Bubble down: restore heap property
  let index = 0;
  while (true) {
    const leftChild = 2 * index + 1;
    const rightChild = 2 * index + 2;
    let largest = index;

    if (
      leftChild < newHeap.length &&
      compareCandidates(newHeap[leftChild], newHeap[largest]) > 0
    ) {
      largest = leftChild;
    }

    if (
      rightChild < newHeap.length &&
      compareCandidates(newHeap[rightChild], newHeap[largest]) > 0
    ) {
      largest = rightChild;
    }

    if (largest === index) {
      break;
    }

    // Swap with larger child
    [newHeap[index], newHeap[largest]] = [newHeap[largest], newHeap[index]];
    index = largest;
  }

  return [top, { ...queue, heap: newHeap }];
}

/**
 * Returns the highest priority candidate without removing it.
 *
 * @param queue - The current queue
 * @returns The highest priority candidate, or undefined if empty
 */
export function peek(
  queue: PriorityDiscoveryQueue,
): PrioritisedCandidate | undefined {
  return queue.heap.length > 0 ? queue.heap[0] : undefined;
}

/**
 * Removes and returns all candidates in priority order.
 *
 * @param queue - The current queue
 * @returns A tuple of [allCandidates, emptyQueue]
 */
export function dequeueAll(
  queue: PriorityDiscoveryQueue,
): [PrioritisedCandidate[], PriorityDiscoveryQueue] {
  const results: PrioritisedCandidate[] = [];
  let currentQueue = queue;

  while (!isEmpty(currentQueue)) {
    const [candidate, newQueue] = dequeue(currentQueue);
    if (candidate) {
      results.push(candidate);
    }
    currentQueue = newQueue;
  }

  return [results, currentQueue];
}

/**
 * Updates the success rate tracking for a change type.
 *
 * @param queue - The current queue
 * @param changeType - The type of change (e.g., "add-synapses")
 * @param succeeded - Whether the candidate improved the score
 * @returns A new queue with updated success rate tracking
 */
export function updateSuccessRate(
  queue: PriorityDiscoveryQueue,
  changeType: string,
  succeeded: boolean,
): PriorityDiscoveryQueue {
  // Get or create stats for this change type
  const currentStats = queue.successStats.get(changeType) ?? {
    successes: 0,
    failures: 0,
  };

  const newStats: SuccessRateStats = {
    successes: currentStats.successes + (succeeded ? 1 : 0),
    failures: currentStats.failures + (succeeded ? 0 : 1),
  };

  // Calculate new success rate
  const total = newStats.successes + newStats.failures;
  const successRate = total > 0
    ? newStats.successes / total
    : DEFAULT_SUCCESS_RATE;

  // Create new maps with updated values
  const newSuccessStats = new Map(queue.successStats);
  newSuccessStats.set(changeType, newStats);

  const newSuccessRates = new Map(queue.successRates);
  newSuccessRates.set(changeType, successRate);

  return {
    ...queue,
    successStats: newSuccessStats,
    successRates: newSuccessRates,
  };
}

/**
 * Compares two candidates for heap ordering.
 *
 * Returns > 0 if a should come before b (higher priority)
 * Returns < 0 if b should come before a
 * Returns 0 if they are equal
 *
 * When priorities are equal, uses insertion order for stable sorting (FIFO).
 */
function compareCandidates(
  a: PrioritisedCandidate,
  b: PrioritisedCandidate,
): number {
  // Higher priority comes first
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }

  // For equal priorities, earlier insertion order comes first (FIFO)
  return b.insertionOrder - a.insertionOrder;
}
