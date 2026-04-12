/**
 * Benchmark: memory pressure and WASM cache behaviour during fitness evaluation
 * (Issue #2263).
 *
 * Measures how different WASM activation LRU cache caps and compilation cache
 * sizes affect fitness evaluation wall time. When the population exceeds the
 * cache cap, evictions force recompilation on subsequent activations — this
 * benchmark quantifies that overhead.
 *
 * Scenarios:
 *   1. **Oversized cache** (cap >= population): no evictions expected.
 *   2. **Tight cache** (cap = population / 2): moderate eviction pressure.
 *   3. **Minimal cache** (cap = 1): simulates critical memory pressure response.
 *   4. **Memory pressure simulation**: applies graduated eviction mid-evaluation.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-net --allow-ffi \
 *     bench/MemoryPressureWasmCache.ts
 */

import { Creature, type CreatureExport } from "../mod.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  getWasmActivationLruStats,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import {
  clearWasmCompilationCache,
  getWasmCompilationCacheStats,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
import { Fitness } from "@architecture/Fitness.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  checkMemoryAndEvict,
  type MemoryCheckResult,
} from "@neat/MemoryMonitor.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import { getLogger } from "@utils/Logger.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const INPUT_COUNT = 3;
const OUTPUT_COUNT = 2;
const DATASET_SIZE = 200;
const PARTITION_BREAK = 50;
const POPULATION_SIZE = 40;

/* ------------------------------------------------------------------ */
/*  Dataset generation                                                 */
/* ------------------------------------------------------------------ */

function generateDataset(): DataRecordInterface[] {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < DATASET_SIZE; i++) {
    const a = (i * 0.005) - 0.5;
    const b = ((i * 7) % DATASET_SIZE) * 0.005 - 0.5;
    const c = ((i * 13) % DATASET_SIZE) * 0.005 - 0.5;
    records.push({
      input: new Float32Array([a, b, c]),
      output: new Float32Array([
        Math.tanh(a + b),
        Math.tanh(b - c),
      ]),
    });
  }
  return records;
}

/* ------------------------------------------------------------------ */
/*  Creature builders (diverse topologies to stress cache)             */
/* ------------------------------------------------------------------ */

/** Build creatures with varied topologies to maximise cache misses. */
function buildDiversePopulation(size: number): Creature[] {
  const squashes = ["TANH", "ReLU", "LOGISTIC", "IDENTITY", "SELU"];
  const creatures: Creature[] = [];

  for (let i = 0; i < size; i++) {
    const hiddenCount = 5 + (i % 8); // 5-12 hidden neurons
    const neurons = [];
    const synapses = [];

    for (let h = 0; h < hiddenCount; h++) {
      neurons.push({
        type: "hidden" as const,
        uuid: `h-${i}-${h}`,
        squash: squashes[h % squashes.length],
        bias: ((h + i) % 11 - 5) * 0.05,
      });
    }
    neurons.push(
      {
        type: "output" as const,
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
      },
      {
        type: "output" as const,
        uuid: "output-1",
        squash: "IDENTITY",
        bias: 0,
      },
    );

    // Input -> first layer
    for (let h = 0; h < Math.min(hiddenCount, 5); h++) {
      for (let j = 0; j < INPUT_COUNT; j++) {
        synapses.push({
          fromUUID: `input-${j}`,
          toUUID: `h-${i}-${h}`,
          weight: ((h + j + i) % 9 - 4) * 0.2,
        });
      }
    }

    // Second layer connections (if enough neurons)
    if (hiddenCount > 5) {
      for (let h = 5; h < hiddenCount; h++) {
        const src = (h - 5) % 5;
        synapses.push({
          fromUUID: `h-${i}-${src}`,
          toUUID: `h-${i}-${h}`,
          weight: ((h * i) % 7 - 3) * 0.15,
        });
      }
    }

    // Output connections
    for (let h = 0; h < hiddenCount; h++) {
      if (h % 3 === 0) {
        synapses.push({
          fromUUID: `h-${i}-${h}`,
          toUUID: `output-${h % OUTPUT_COUNT}`,
          weight: ((h + i) % 5 - 2) * 0.3,
        });
      }
    }

    const json: CreatureExport = {
      input: INPUT_COUNT,
      output: OUTPUT_COUNT,
      neurons,
      synapses,
    };
    const creature = Creature.fromJSON(json);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }

  return creatures;
}

/* ------------------------------------------------------------------ */
/*  Shared fixture setup                                               */
/* ------------------------------------------------------------------ */

const dataset = generateDataset();
const dataSetDir = makeDataDir(dataset, PARTITION_BREAK);

function createRealFitness(): { fitness: Fitness; workers: WorkerHandler[] } {
  const workers = [new WorkerHandler(dataSetDir, "MSE", true)];
  const fitness = new Fitness(workers, 0.0001, false);
  return { fitness, workers };
}

/**
 * Reset all caches to a known state before each benchmark iteration.
 */
function resetCaches(activationCap: number, compilationCap: number): void {
  clearWasmCompilationCache();
  setMaxCachedWasmCreatureActivations(activationCap);
  setWasmCompilationCacheSize(compilationCap);
  resetWasmActivationLruStats();
}

/* ------------------------------------------------------------------ */
/*  Benchmarks                                                         */
/* ------------------------------------------------------------------ */

// Pre-build the population once (diverse topologies).
const population = buildDiversePopulation(POPULATION_SIZE);

console.log(`\nMemory Pressure + WASM Cache Benchmark (Issue #2263)`);
console.log(`  Population: ${POPULATION_SIZE} creatures (diverse topologies)`);
console.log(`  Dataset: ${DATASET_SIZE} records, ${PARTITION_BREAK}/partition`);

// --- Oversized cache: no evictions expected ---
Deno.bench({
  name: `fitness eval — cache cap ${POPULATION_SIZE * 2} (no eviction)`,
  group: "cache-pressure",
  baseline: true,
  async fn() {
    resetCaches(POPULATION_SIZE * 2, POPULATION_SIZE * 2);
    const { fitness } = createRealFitness();
    await fitness.calculate([...population]);
  },
});

// --- Tight cache: moderate eviction pressure ---
Deno.bench({
  name: `fitness eval — cache cap ${POPULATION_SIZE / 2} (moderate eviction)`,
  group: "cache-pressure",
  async fn() {
    resetCaches(POPULATION_SIZE / 2, POPULATION_SIZE / 2);
    const { fitness } = createRealFitness();
    await fitness.calculate([...population]);
  },
});

// --- Minimal cache: simulates critical memory pressure ---
Deno.bench({
  name: "fitness eval — cache cap 1 (critical pressure)",
  group: "cache-pressure",
  async fn() {
    resetCaches(1, 1);
    const { fitness } = createRealFitness();
    await fitness.calculate([...population]);
  },
});

// --- Default cache: production defaults ---
Deno.bench({
  name: "fitness eval — default cache (512 activation, 100 compilation)",
  group: "cache-pressure",
  async fn() {
    resetCaches(512, 100);
    const { fitness } = createRealFitness();
    await fitness.calculate([...population]);
  },
});

// --- Memory pressure simulation: evict mid-evaluation ---
Deno.bench({
  name: "fitness eval — with simulated memory pressure check",
  group: "cache-pressure",
  async fn() {
    resetCaches(POPULATION_SIZE * 2, POPULATION_SIZE * 2);
    const { fitness } = createRealFitness();

    // Evaluate half the population
    const half = Math.floor(population.length / 2);
    await fitness.calculate(population.slice(0, half));

    // Simulate a memory pressure check (as done per-generation in evolve loop)
    const _memResult: MemoryCheckResult = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      getLogger(),
    );

    // Evaluate the remaining half
    await fitness.calculate(population.slice(half));
  },
});

// --- Diagnostic: direct activation to observe cache behaviour ---
Deno.bench({
  name: "direct activation — cache stats diagnostic",
  group: "diagnostics",
  fn() {
    resetCaches(POPULATION_SIZE, POPULATION_SIZE);
    const input = new Float32Array(INPUT_COUNT);
    for (let j = 0; j < INPUT_COUNT; j++) input[j] = 0.5;

    for (const creature of population) {
      creature.activate(input, false);
    }
  },
});

// Print a one-time diagnostic summary after benchmarks complete.
addEventListener("unload", () => {
  // Run one final diagnostic pass to show cache behaviour.
  resetCaches(POPULATION_SIZE, POPULATION_SIZE);
  const input = new Float32Array(INPUT_COUNT);
  for (let j = 0; j < INPUT_COUNT; j++) input[j] = 0.5;
  for (const creature of population) {
    creature.activate(input, false);
  }
  const lru = getWasmActivationLruStats();
  const comp = getWasmCompilationCacheStats();
  console.log(
    `\n  Cache diagnostic (cap=${POPULATION_SIZE}, ${POPULATION_SIZE} creatures):`,
  );
  console.log(
    `    Activation LRU — hits: ${lru.hits}, misses: ${lru.misses}, ` +
      `evictions: ${lru.evictions}, size: ${lru.currentSize}/${lru.maxSize}`,
  );
  console.log(
    `    Compilation    — hits: ${comp.hits}, misses: ${comp.misses}, ` +
      `evictions: ${comp.evictions}, size: ${comp.size}`,
  );

  try {
    Deno.removeSync(dataSetDir, { recursive: true });
  } catch {
    // Best-effort cleanup.
  }
});
