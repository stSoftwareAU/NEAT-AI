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
 */

import type { Creature } from "../Creature.ts";

interface LruEntry {
  ref: WeakRef<Creature>;
  lastAccess: number;
}

const finaliser = new FinalizationRegistry<number>((id) => {
  entries.delete(id);
});

const idByCreature = new WeakMap<Creature, number>();
const entries = new Map<number, LruEntry>();
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

function evictIfNeeded(): void {
  while (entries.size > maxCachedWasmActivations) {
    let oldestId: number | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of entries) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestId = id;
      }
    }

    if (oldestId === null) return;

    const entry = entries.get(oldestId);
    if (!entry) {
      entries.delete(oldestId);
      continue;
    }

    const creature = entry.ref.deref();
    entries.delete(oldestId);

    if (!creature) {
      continue;
    }

    try {
      creature.disposeWasm();
    } catch {
      // Best-effort eviction; ignore failures.
    }
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
 */
export function noteWasmCreatureActivationUse(creature: Creature): void {
  const id = getOrAssignId(creature);
  entries.set(id, {
    ref: new WeakRef(creature),
    lastAccess: performance.now(),
  });
  evictIfNeeded();
}

/**
 * Apply memory-pressure relief by evicting up to `count` old entries immediately.
 *
 * Intended for use when instantiation fails (likely OOM) and a retry might succeed.
 */
export function evictOldestWasmCreatureActivations(count: number): void {
  const target = Math.max(0, Math.floor(count));
  if (target === 0) return;

  for (let i = 0; i < target && entries.size > 0; i++) {
    let oldestId: number | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of entries) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestId = id;
      }
    }

    if (oldestId === null) return;

    const entry = entries.get(oldestId);
    entries.delete(oldestId);
    const creature = entry?.ref.deref();
    if (!creature) continue;
    try {
      creature.disposeWasm();
    } catch {
      // Ignore
    }
  }
}
