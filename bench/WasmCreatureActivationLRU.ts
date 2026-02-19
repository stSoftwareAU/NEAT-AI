/**
 * WASM Creature Activation LRU Benchmark
 *
 * Issue #1534 - O(1) LRU eviction for WasmCreatureActivationLRU hot path
 *
 * Measures the performance of:
 * 1. noteWasmCreatureActivationUse() — the hot path called on every forward pass
 * 2. evictOldestWasmCreatureActivations() — bulk eviction under memory pressure
 *
 * Run with:
 *   deno bench --allow-read bench/WasmCreatureActivationLRU.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  evictOldestWasmCreatureActivations,
  noteWasmCreatureActivationUse,
  setMaxCachedWasmCreatureActivations,
} from "../src/wasm/WasmCreatureActivationLRU.ts";

/** Create a minimal creature for benchmarking. */
function createMinimalCreature(): Creature {
  const creature = new Creature(1, 1);
  creature.fix();
  return creature;
}

// Pre-create creatures for the benchmark
const POOL_SIZE = 512;
const creatures: Creature[] = [];
for (let i = 0; i < POOL_SIZE; i++) {
  creatures.push(createMinimalCreature());
}

// ---------------------------------------------------------------------------
// noteWasmCreatureActivationUse — existing entry (update-in-place hot path)
// ---------------------------------------------------------------------------

Deno.bench(
  "LRU noteUse: existing entry (update in place)",
  { group: "lru-note-use" },
  () => {
    setMaxCachedWasmCreatureActivations(POOL_SIZE);
    // Prime the cache
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }
    // Now re-access — this is the hot path
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }
  },
);

// ---------------------------------------------------------------------------
// noteWasmCreatureActivationUse — with eviction (capacity exceeded)
// ---------------------------------------------------------------------------

Deno.bench(
  "LRU noteUse: with eviction at capacity 256",
  { group: "lru-eviction" },
  () => {
    setMaxCachedWasmCreatureActivations(256);
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }
  },
);

// ---------------------------------------------------------------------------
// evictOldestWasmCreatureActivations — bulk eviction
// ---------------------------------------------------------------------------

Deno.bench(
  "LRU evictOldest: bulk evict 256 of 512",
  { group: "lru-bulk-evict" },
  () => {
    setMaxCachedWasmCreatureActivations(POOL_SIZE);
    for (const c of creatures) {
      noteWasmCreatureActivationUse(c);
    }
    evictOldestWasmCreatureActivations(256);
  },
);
