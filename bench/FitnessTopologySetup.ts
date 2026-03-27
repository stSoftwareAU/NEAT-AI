/**
 * Benchmark for fitness evaluation setup — queue preparation and sorting
 * (Issue #2043).
 *
 * Measures the overhead of array copying and topology hash computation
 * during the fitness evaluation setup phase, comparing:
 *   - Baseline: always copy array + compute hashes in comparator
 *   - Optimised: skip copy when grouping is off; pre-compute hashes when on
 *
 * Population creation is done outside the benchmark loop so only the
 * setup phase is measured.
 *
 * Run with:
 *   deno bench bench/FitnessTopologySetup.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";

/**
 * Create a population with varied topologies for benchmarking.
 */
function createPopulation(size: number, topologyCount: number): Creature[] {
  const squashes = ["TANH", "LOGISTIC", "RELU", "IDENTITY", "BIPOLAR_SIGMOID"];
  const creatures: Creature[] = [];

  for (let i = 0; i < size; i++) {
    const topologyIndex = i % topologyCount;
    const squash = squashes[topologyIndex % squashes.length];
    const hiddenCount = 1 + (topologyIndex % 3);

    const neurons: CreatureExport["neurons"] = [];
    const synapses: CreatureExport["synapses"] = [];

    for (let h = 0; h < hiddenCount; h++) {
      neurons.push({
        type: "hidden",
        uuid: `hidden-${h}`,
        squash,
        bias: 0.1 * (i + 1),
      });
      synapses.push({
        fromUUID: "input-0",
        toUUID: `hidden-${h}`,
        weight: 0.5 + i * 0.001,
      });
    }

    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0.1,
    });
    synapses.push({
      fromUUID: `hidden-${hiddenCount - 1}`,
      toUUID: "output-0",
      weight: 0.8,
    });

    const data: CreatureExport = { neurons, synapses, input: 2, output: 1 };
    const creature = Creature.fromJSON(data);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }

  return creatures;
}

/**
 * Clear cached topology hashes so each benchmark iteration starts fresh.
 */
function clearTopologyHashes(creatures: Creature[]) {
  for (const creature of creatures) {
    creature.topologyHash = undefined;
  }
}

// --- Baseline: always copy + hashes in comparator ---

function baselineSetup(uniqueQueue: Creature[], topologyGrouping: boolean) {
  if (topologyGrouping) {
    const queue = [...uniqueQueue];
    queue.sort((a, b) => {
      const hashA = CreatureUtil.getTopologyHash(a);
      const hashB = CreatureUtil.getTopologyHash(b);
      return hashA.localeCompare(hashB);
    });
    return queue;
  } else {
    return [...uniqueQueue];
  }
}

// --- Optimised: skip copy when off; pre-compute hashes when on ---

function optimisedSetup(uniqueQueue: Creature[], topologyGrouping: boolean) {
  if (topologyGrouping) {
    const hashCache = new Map<Creature, string>();
    for (const creature of uniqueQueue) {
      hashCache.set(creature, CreatureUtil.getTopologyHash(creature));
    }
    uniqueQueue.sort((a, b) => {
      return hashCache.get(a)!.localeCompare(hashCache.get(b)!);
    });
    return uniqueQueue;
  } else {
    return uniqueQueue;
  }
}

// Pre-create populations outside the benchmark loop
const pop100 = createPopulation(100, 10);
const pop500 = createPopulation(500, 10);
const pop1000 = createPopulation(1000, 10);

// ============================================
// Topology grouping DISABLED — measures array copy overhead
// ============================================

Deno.bench({
  name: "Baseline (copy) — no grouping, 100 creatures",
  group: "no-grouping-100",
  baseline: true,
  fn() {
    baselineSetup(pop100, false);
  },
});

Deno.bench({
  name: "Optimised (no copy) — no grouping, 100 creatures",
  group: "no-grouping-100",
  fn() {
    optimisedSetup(pop100, false);
  },
});

Deno.bench({
  name: "Baseline (copy) — no grouping, 500 creatures",
  group: "no-grouping-500",
  baseline: true,
  fn() {
    baselineSetup(pop500, false);
  },
});

Deno.bench({
  name: "Optimised (no copy) — no grouping, 500 creatures",
  group: "no-grouping-500",
  fn() {
    optimisedSetup(pop500, false);
  },
});

Deno.bench({
  name: "Baseline (copy) — no grouping, 1000 creatures",
  group: "no-grouping-1000",
  baseline: true,
  fn() {
    baselineSetup(pop1000, false);
  },
});

Deno.bench({
  name: "Optimised (no copy) — no grouping, 1000 creatures",
  group: "no-grouping-1000",
  fn() {
    optimisedSetup(pop1000, false);
  },
});

// ============================================
// Topology grouping ENABLED — measures hash computation overhead
// ============================================

Deno.bench({
  name: "Baseline (hash in comparator) — grouping, 100 creatures",
  group: "grouping-100",
  baseline: true,
  fn() {
    clearTopologyHashes(pop100);
    baselineSetup([...pop100], true);
  },
});

Deno.bench({
  name: "Optimised (pre-computed hash) — grouping, 100 creatures",
  group: "grouping-100",
  fn() {
    clearTopologyHashes(pop100);
    optimisedSetup([...pop100], true);
  },
});

Deno.bench({
  name: "Baseline (hash in comparator) — grouping, 500 creatures",
  group: "grouping-500",
  baseline: true,
  fn() {
    clearTopologyHashes(pop500);
    baselineSetup([...pop500], true);
  },
});

Deno.bench({
  name: "Optimised (pre-computed hash) — grouping, 500 creatures",
  group: "grouping-500",
  fn() {
    clearTopologyHashes(pop500);
    optimisedSetup([...pop500], true);
  },
});

Deno.bench({
  name: "Baseline (hash in comparator) — grouping, 1000 creatures",
  group: "grouping-1000",
  baseline: true,
  fn() {
    clearTopologyHashes(pop1000);
    baselineSetup([...pop1000], true);
  },
});

Deno.bench({
  name: "Optimised (pre-computed hash) — grouping, 1000 creatures",
  group: "grouping-1000",
  fn() {
    clearTopologyHashes(pop1000);
    optimisedSetup([...pop1000], true);
  },
});
