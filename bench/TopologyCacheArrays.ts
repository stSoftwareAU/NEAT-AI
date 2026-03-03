/**
 * Benchmark: Topology cache Maps vs flat indexed arrays (Issue #1660)
 *
 * Measures inwardConnections() and outwardConnections() lookup throughput
 * across creatures of varying size, comparing Map-based caches with
 * flat array-based caches.
 *
 * Run with: deno bench --allow-read bench/TopologyCacheArrays.ts
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

// Get all neuron indices that could have outward connections
const sourceIndices: number[] = [];
for (let i = 0; i < creature.neurons.length - creature.output; i++) {
  sourceIndices.push(i);
}

/**
 * Benchmark: Cached inward connection lookups
 */
Deno.bench("TopologyCache: inward lookups (cached)", () => {
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});

/**
 * Benchmark: Cached outward connection lookups
 */
Deno.bench("TopologyCache: outward lookups (cached)", () => {
  for (const indx of sourceIndices) {
    creature.outwardConnections(indx);
  }
});

/**
 * Benchmark: Inward lookups after full cache clear (rebuild scenario)
 */
Deno.bench("TopologyCache: inward lookups (rebuild)", () => {
  creature.clearCache();
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
});

/**
 * Benchmark: Outward lookups after full cache clear (rebuild scenario)
 */
Deno.bench("TopologyCache: outward lookups (rebuild)", () => {
  creature.clearCache();
  for (const indx of sourceIndices) {
    creature.outwardConnections(indx);
  }
});

/**
 * Benchmark: Repeated partial invalidations with mixed lookups
 */
Deno.bench("TopologyCache: partial invalidation cycle", () => {
  for (let i = 0; i < 10; i++) {
    creature.clearCache(0, targetIndices[i % targetIndices.length]);
    for (let j = 0; j < 5; j++) {
      creature.inwardConnections(
        targetIndices[(i + j) % targetIndices.length],
      );
      creature.outwardConnections(
        sourceIndices[(i + j) % sourceIndices.length],
      );
    }
  }
});

/**
 * Benchmark: Bulk load + all lookups
 */
Deno.bench("TopologyCache: bulkLoad + all lookups", () => {
  creature.clearCache();
  creature.bulkLoadInwardConnections();
  for (const indx of targetIndices) {
    creature.inwardConnections(indx);
  }
  for (const indx of sourceIndices) {
    creature.outwardConnections(indx);
  }
});
