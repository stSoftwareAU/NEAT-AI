/**
 * Priority-Based Discovery Replay Queue
 *
 * Implements a priority queue for discovery replay that orders candidates by
 * expected improvement, processing the most promising discoveries first.
 *
 * Issue #1299 - Performance: Priority-based discovery replay queue
 *
 * Key features:
 * - Max-heap structure for O(log n) enqueue/dequeue
 * - Priority scoring based on:
 *   - Previous success rate for similar modifications
 *   - Improvement magnitude (scoreDelta) in original discovery
 * - Deprioritisation of repeatedly unsuccessful candidate types
 * - Success rate tracking to refine priority scoring
 */

import type { SuccessCacheEntry } from "./SuccessCache.ts";

/**
 * A candidate wrapped with its calculated priority.
 */
export interface PrioritisedCandidate {
  entry: SuccessCacheEntry;
  priority: number;
  /** Insertion order for FIFO tie-breaking within equal priorities */
  insertionOrder: number;
}

/**
 * Options for calculating priority.
 */
export interface CalculatePriorityOptions {
  /**
   * Map of changeType -> success rate (0-1).
   * Used to boost candidates of types that historically succeed.
   */
  successRates?: Map<string, number>;
  /**
   * Map of changeType -> failure count.
   * Used to penalise candidates of types that repeatedly fail.
   */
  failureCounts?: Map<string, number>;
  /**
   * Weight for success rate boost (default: 0.5).
   * Higher values increase the impact of historical success.
   */
  successRateWeight?: number;
  /**
   * Penalty per failure (default: 0.05).
   * Higher values penalise failed types more aggressively.
   */
  failurePenaltyWeight?: number;
  /**
   * Minimum priority floor to prevent complete deprioritisation (default: 0).
   */
  minPriority?: number;
}

/**
 * Calculate priority for a success cache entry.
 *
 * Priority is based on:
 * 1. Base priority: scoreDelta from the original discovery
 * 2. Success rate multiplier: boost candidates of types that historically succeed
 * 3. Failure penalty: reduce priority for types that repeatedly fail
 *
 * Formula: priority = max(minPriority, scoreDelta * successMultiplier * failureMultiplier)
 *
 * @param entry - The success cache entry to calculate priority for
 * @param options - Options controlling priority calculation
 * @returns The calculated priority value
 */
export function calculatePriority(
  entry: SuccessCacheEntry,
  options: CalculatePriorityOptions,
): number {
  const {
    successRates,
    failureCounts,
    successRateWeight = 0.5,
    failurePenaltyWeight = 0.05,
    minPriority = 0,
  } = options;

  // Base priority is the score delta from the original discovery
  const basePriority = typeof entry.scoreDelta === "number"
    ? entry.scoreDelta
    : 0;

  if (basePriority <= 0) {
    return Math.max(minPriority, 0);
  }

  // Calculate success rate multiplier
  let successMultiplier = 1;
  if (successRates) {
    const successRate = successRates.get(entry.changeType);
    if (successRate !== undefined && Number.isFinite(successRate)) {
      // Boost priority based on historical success: 1 + (successRate * weight)
      successMultiplier = 1 + successRate * successRateWeight;
    }
  }

  // Calculate failure penalty multiplier
  let failureMultiplier = 1;
  if (failureCounts) {
    const failureCount = failureCounts.get(entry.changeType);
    if (failureCount !== undefined && failureCount > 0) {
      // Reduce priority based on failure count: 1 - (failureCount * penalty)
      // Cap at 0 to avoid negative multipliers
      failureMultiplier = Math.max(0, 1 - failureCount * failurePenaltyWeight);
    }
  }

  // Calculate final priority
  const priority = basePriority * successMultiplier * failureMultiplier;

  return Math.max(minPriority, priority);
}

/**
 * Priority queue for discovery replay candidates.
 *
 * Implements a max-heap to efficiently process candidates in priority order,
 * ensuring the most promising discoveries are evaluated first.
 *
 * Time complexities:
 * - enqueue: O(log n)
 * - dequeue: O(log n)
 * - peek: O(1)
 * - updatePriority: O(n) (requires finding the item first)
 * - size/isEmpty: O(1)
 */
export class PriorityDiscoveryQueue {
  /** Internal heap storage */
  #heap: PrioritisedCandidate[] = [];

  /** Map from key to heap index for efficient lookup */
  #keyToIndex: Map<string, number> = new Map();

  /** Counter for insertion order (FIFO tie-breaking) */
  #insertionCounter = 0;

  /**
   * Add a candidate to the queue with the given priority.
   *
   * If a candidate with the same key already exists, it is replaced.
   *
   * @param entry - The success cache entry to add
   * @param priority - The priority value (higher = processed first)
   */
  enqueue(entry: SuccessCacheEntry, priority: number): void {
    const key = entry.key;

    // Check if entry already exists
    const existingIndex = this.#keyToIndex.get(key);
    if (existingIndex !== undefined) {
      // Replace existing entry
      this.#heap[existingIndex] = {
        entry,
        priority,
        insertionOrder: this.#insertionCounter++,
      };
      // Re-heapify from the updated position
      this.#bubbleUp(existingIndex);
      this.#bubbleDown(existingIndex);
      return;
    }

    // Add new entry
    const candidate: PrioritisedCandidate = {
      entry,
      priority,
      insertionOrder: this.#insertionCounter++,
    };

    this.#heap.push(candidate);
    this.#keyToIndex.set(key, this.#heap.length - 1);
    this.#bubbleUp(this.#heap.length - 1);
  }

  /**
   * Remove and return the highest priority candidate.
   *
   * @returns The highest priority candidate, or undefined if the queue is empty
   */
  dequeue(): PrioritisedCandidate | undefined {
    if (this.#heap.length === 0) {
      return undefined;
    }

    const result = this.#heap[0];
    this.#keyToIndex.delete(result.entry.key);

    if (this.#heap.length === 1) {
      this.#heap.pop();
      return result;
    }

    // Move last element to root and bubble down
    const last = this.#heap.pop()!;
    this.#heap[0] = last;
    this.#keyToIndex.set(last.entry.key, 0);
    this.#bubbleDown(0);

    return result;
  }

  /**
   * Return the highest priority candidate without removing it.
   *
   * @returns The highest priority candidate, or undefined if the queue is empty
   */
  peek(): PrioritisedCandidate | undefined {
    return this.#heap[0];
  }

  /**
   * Update the priority of an existing candidate.
   *
   * If the candidate is not found, this is a no-op.
   *
   * @param key - The cache key of the candidate to update
   * @param newPriority - The new priority value
   */
  updatePriority(key: string, newPriority: number): void {
    const index = this.#keyToIndex.get(key);
    if (index === undefined) {
      return;
    }

    const oldPriority = this.#heap[index].priority;
    this.#heap[index].priority = newPriority;

    if (newPriority > oldPriority) {
      this.#bubbleUp(index);
    } else if (newPriority < oldPriority) {
      this.#bubbleDown(index);
    }
  }

  /**
   * Reduce the priority of a candidate by a multiplier.
   *
   * Useful for deprioritising candidates of types that fail.
   *
   * @param key - The cache key of the candidate to deprioritise
   * @param multiplier - The multiplier to apply (e.g., 0.5 halves priority)
   */
  deprioritise(key: string, multiplier: number): void {
    const index = this.#keyToIndex.get(key);
    if (index === undefined) {
      return;
    }

    const newPriority = this.#heap[index].priority * multiplier;
    this.updatePriority(key, newPriority);
  }

  /**
   * Remove a candidate by key.
   *
   * @param key - The cache key of the candidate to remove
   * @returns True if the candidate was found and removed, false otherwise
   */
  remove(key: string): boolean {
    const index = this.#keyToIndex.get(key);
    if (index === undefined) {
      return false;
    }

    this.#keyToIndex.delete(key);

    if (index === this.#heap.length - 1) {
      this.#heap.pop();
      return true;
    }

    const last = this.#heap.pop()!;
    this.#heap[index] = last;
    this.#keyToIndex.set(last.entry.key, index);
    this.#bubbleUp(index);
    this.#bubbleDown(index);

    return true;
  }

  /**
   * Get the number of candidates in the queue.
   */
  size(): number {
    return this.#heap.length;
  }

  /**
   * Check if the queue is empty.
   */
  isEmpty(): boolean {
    return this.#heap.length === 0;
  }

  /**
   * Remove all candidates from the queue.
   */
  clear(): void {
    this.#heap = [];
    this.#keyToIndex.clear();
    this.#insertionCounter = 0;
  }

  /**
   * Return all candidates in priority order (highest first).
   *
   * Does not modify the queue.
   */
  toArray(): PrioritisedCandidate[] {
    // Create a copy and sort by priority (descending), then by insertion order (ascending)
    return [...this.#heap].sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.insertionOrder - b.insertionOrder;
    });
  }

  /**
   * Bubble up an element to maintain heap property.
   */
  #bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (!this.#shouldSwap(index, parentIndex)) {
        break;
      }
      this.#swap(index, parentIndex);
      index = parentIndex;
    }
  }

  /**
   * Bubble down an element to maintain heap property.
   */
  #bubbleDown(index: number): void {
    const length = this.#heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let largest = index;

      if (leftChild < length && this.#shouldSwap(leftChild, largest)) {
        largest = leftChild;
      }

      if (rightChild < length && this.#shouldSwap(rightChild, largest)) {
        largest = rightChild;
      }

      if (largest === index) {
        break;
      }

      this.#swap(index, largest);
      index = largest;
    }
  }

  /**
   * Check if element at indexA should be above element at indexB.
   * Returns true if A has higher priority, or equal priority with earlier insertion.
   */
  #shouldSwap(indexA: number, indexB: number): boolean {
    const a = this.#heap[indexA];
    const b = this.#heap[indexB];

    if (a.priority !== b.priority) {
      return a.priority > b.priority;
    }

    // For equal priorities, use insertion order (FIFO: earlier insertion wins)
    return a.insertionOrder < b.insertionOrder;
  }

  /**
   * Swap two elements in the heap and update the key-to-index map.
   */
  #swap(indexA: number, indexB: number): void {
    const temp = this.#heap[indexA];
    this.#heap[indexA] = this.#heap[indexB];
    this.#heap[indexB] = temp;

    this.#keyToIndex.set(this.#heap[indexA].entry.key, indexA);
    this.#keyToIndex.set(this.#heap[indexB].entry.key, indexB);
  }
}
