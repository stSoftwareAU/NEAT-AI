/**
 * WASM Creature activation LRU eviction.
 *
 * Issue #1338: In long-running, highly-parallel workloads that touch many different
 * creatures/models, caching `CompiledNetwork` instances on each `Creature` can
 * accumulate large WASM heap usage. If GC/finalizers lag, instantiating a new
 * `CompiledNetwork` may trap (often as `RuntimeError: unreachable`).
 *
 * This module implements a best-effort LRU that can proactively free older cached
 * WASM activations by calling `creature.disposeWasm()`.
 *
 * Design notes:
 * - We only keep `WeakRef`s to avoid preventing GC.
 * - Eviction is conservative and only runs when the configured cap is exceeded.
 * - Evicting a creature's cached activation is safe: it is recreated lazily on next use.
 *
 * Issue #1534: Uses a doubly-linked list + Map for O(1) lookup, insertion,
 * move-to-head, and tail eviction — replacing the previous O(n) linear scan.
 */

import type { Creature } from "../Creature.ts";

/** A node in the doubly-linked LRU list. */
interface LruNode {
  readonly id: number;
  ref: WeakRef<Creature>;
  prev: LruNode | null;
  next: LruNode | null;
}

/** Sentinel head node — most recently used entries are near the head. */
let head: LruNode | null = null;
/** Sentinel tail node — least recently used entries are at the tail. */
let tail: LruNode | null = null;

const finaliser = new FinalizationRegistry<number>((id) => {
  const node = nodeById.get(id);
  if (node) {
    removeNode(node);
    nodeById.delete(id);
  }
});

const idByCreature = new WeakMap<Creature, number>();
const nodeById = new Map<number, LruNode>();
let nextId = 1;

// Default cap: keep memory bounded for inference/data-gen workloads without
// noticeably impacting typical NEAT populations.
let maxCachedWasmActivations = 512;

function getOrAssignId(creature: Creature): number {
  const existing = idByCreature.get(creature);
  if (existing !== undefined) return existing;

  const id = nextId++;
  idByCreature.set(creature, id);
  finaliser.register(creature, id);
  return id;
}

/** Remove a node from the doubly-linked list (O(1)). */
function removeNode(node: LruNode): void {
  const prev = node.prev;
  const next = node.next;

  if (prev) {
    prev.next = next;
  } else {
    head = next;
  }

  if (next) {
    next.prev = prev;
  } else {
    tail = prev;
  }

  node.prev = null;
  node.next = null;
}

/** Move/insert a node to the head of the list (most recently used). */
function moveToHead(node: LruNode): void {
  // Already at head — nothing to do.
  if (head === node) return;

  // Unlink from current position if already in the list.
  if (node.prev || node.next || tail === node) {
    removeNode(node);
  }

  // Insert at head.
  node.next = head;
  node.prev = null;
  if (head) {
    head.prev = node;
  }
  head = node;

  if (!tail) {
    tail = node;
  }
}

/** Evict the tail (oldest) entry, calling disposeWasm on it. Returns true if evicted. */
function evictTail(): boolean {
  if (!tail) return false;

  const node = tail;
  removeNode(node);
  nodeById.delete(node.id);

  const creature = node.ref.deref();
  if (!creature) return true;

  try {
    creature.disposeWasm();
  } catch {
    // Best-effort eviction; ignore failures.
  }
  return true;
}

function evictIfNeeded(): void {
  while (nodeById.size > maxCachedWasmActivations) {
    if (!evictTail()) return;
  }
}

/**
 * Set the maximum number of cached WASM activations kept across all live creatures.
 *
 * Values < 1 are clamped to 1.
 */
export function setMaxCachedWasmCreatureActivations(max: number): void {
  maxCachedWasmActivations = Math.max(1, Math.floor(max));
  evictIfNeeded();
}

/**
 * Get the current maximum number of cached WASM activations.
 */
export function getMaxCachedWasmCreatureActivations(): number {
  return maxCachedWasmActivations;
}

/**
 * Record usage of a creature's cached WASM activation and evict if needed.
 *
 * Call this after a creature successfully acquires/uses `cachedWasmActivation`.
 *
 * Issue #1534: When the entry already exists, moves the node to the head in O(1)
 * without allocating a new object or WeakRef.
 */
export function noteWasmCreatureActivationUse(creature: Creature): void {
  const id = getOrAssignId(creature);

  const existing = nodeById.get(id);
  if (existing) {
    // Move existing entry to head — no allocation needed.
    moveToHead(existing);
  } else {
    // New entry: create node, insert at head.
    const node: LruNode = {
      id,
      ref: new WeakRef(creature),
      prev: null,
      next: null,
    };
    nodeById.set(id, node);
    moveToHead(node);
  }

  evictIfNeeded();
}

/**
 * Get the current number of entries in the LRU cache.
 *
 * Issue #1504: Allows callers to observe cache occupancy for diagnostics
 * and to verify that ephemeral activations do not inflate the cache.
 */
export function getCachedWasmActivationCount(): number {
  return nodeById.size;
}

/**
 * Apply memory-pressure relief by evicting up to `count` old entries immediately.
 *
 * Intended for use when instantiation fails (likely OOM) and a retry might succeed.
 */
export function evictOldestWasmCreatureActivations(count: number): void {
  const target = Math.max(0, Math.floor(count));
  for (let i = 0; i < target; i++) {
    if (!evictTail()) return;
  }
}

/**
 * Flush the entire WASM LRU cache and dispose all entries.
 *
 * Issue #1581: Provides a bulk cleanup API for use between training runs
 * or prefixes, ensuring all cached WASM linear memory is freed.
 *
 * @returns The number of entries disposed.
 */
export function disposeAllCachedWasmActivations(): number {
  let disposed = 0;
  while (tail) {
    evictTail();
    disposed++;
  }
  return disposed;
}

/**
 * Remove a creature from the LRU cache without calling disposeWasm.
 *
 * Issue #1581: When a creature is manually disposed (e.g. via `creature.dispose()`),
 * its LRU node should be removed so it no longer counts against the cache cap.
 * The caller is responsible for having already called disposeWasm.
 */
export function deregisterWasmCreatureActivation(creature: Creature): void {
  const id = idByCreature.get(creature);
  if (id === undefined) return;

  const node = nodeById.get(id);
  if (node) {
    removeNode(node);
    nodeById.delete(id);
  }
}
