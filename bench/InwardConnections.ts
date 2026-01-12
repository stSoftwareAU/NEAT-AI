/**
 * Benchmark: Indexed inward connections lookup (Issue #1010)
 *
 * This benchmark measures the performance of inwardConnections() lookups,
 * particularly after cache invalidation which triggers the bulk load mechanism.
 *
 * The key scenario being optimised:
 * - Large creatures with many synapses
 * - Frequent cache invalidation during mutations
 * - Multiple lookups for different neurons
 *
 * Run with: deno bench --allow-read bench/InwardConnections.ts
 *
 * Performance comparison (1001 neurons, 2448 synapses, Apple M4 Pro):
 *
 * Before (v0.xxx - bulk load on any miss):
 *   rebuild (single lookup):              113.1 µs
 *   rebuild + all lookups:                 95.4 µs
 *   10 partial invalidations + lookups:  ~6000 µs (estimated)
 *
 * After (Issue #1010 - indexed lookup with adaptive threshold):
 *   rebuild (single lookup):               19.2 µs (5.9x faster)
 *   rebuild + all lookups:                748.3 µs (7.8x slower - expected tradeoff)
 *   10 partial invalidations + lookups:   201.7 µs (30x faster)
 *   prebuild + all lookups:               713.0 µs
 *   bulkLoad + all lookups:               676.1 µs
 *
 * Key improvements:
 * - Single lookup after cache clear is 5.9x faster
 * - Repeated partial invalidations are 30x faster
 * - For bulk lookups, use prebuildInwardIndex() or bulkLoadInwardConnections()
 */
import { Creature } from "../src/Creature.ts";

const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync(creatureFile),
  ),
);
creature.fix();

console.log(
  `Creature: ${creature.neurons.length} neurons, ${creature.synapses.length} synapses`,
);

// Get all neuron indices that could have inward connections (hidden + output)
const targetIndices: number[] = [];
for (let i = creature.input; i < creature.neurons.length; i++) {
  targetIndices.push(i);
}

/**
 * Benchmark: Single lookup (cached)
 * After the first call, subsequent calls should hit the cache.
 */
Deno.bench("InwardConnections (cached)", () => {
  // Just do lookups without clearing cache - measures cache hit performance
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});

/**
 * Benchmark: Full rebuild scenario
 * This simulates what happens after a mutation clears the cache.
 * The first lookup triggers a full rebuild of the inward connections cache.
 */
Deno.bench("InwardConnections (rebuild)", () => {
  // Clear the cache to force a rebuild
  creature.clearCache();
  // Lookup a single neuron - this triggers the bulk load
  creature.inwardConnections(targetIndices[0]);
});

/**
 * Benchmark: Multiple lookups after cache clear
 * This simulates multiple inwardConnections calls after a mutation.
 */
Deno.bench("InwardConnections (rebuild + all lookups)", () => {
  // Clear the cache to force a rebuild
  creature.clearCache();
  // Lookup all neurons
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});

/**
 * Benchmark: Repeated partial invalidations
 * This simulates what happens during mutations where the cache is
 * partially invalidated multiple times and lookups happen in between.
 */
Deno.bench("InwardConnections (10 partial invalidations + lookups)", () => {
  for (let i = 0; i < 10; i++) {
    // Simulate a partial cache clear (e.g., adding a synapse)
    creature.clearCache(0, targetIndices[i % targetIndices.length]);
    // Lookup a few neurons
    for (let j = 0; j < 5; j++) {
      creature.inwardConnections(targetIndices[(i + j) % targetIndices.length]);
    }
  }
});

/**
 * Benchmark: Pre-built index + all lookups
 * This simulates the optimal case where we know we'll need many lookups
 * and pre-build the index first using prebuildInwardIndex().
 */
Deno.bench("InwardConnections (prebuild + all lookups)", () => {
  creature.clearCache();
  creature.prebuildInwardIndex();
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});

/**
 * Benchmark: Bulk load scenario
 * This simulates the case where you need to look up all neurons and
 * use bulkLoadInwardConnections() for optimal performance.
 */
Deno.bench("InwardConnections (bulkLoad + all lookups)", () => {
  creature.clearCache();
  creature.bulkLoadInwardConnections();
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});
