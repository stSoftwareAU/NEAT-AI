/**
 * Benchmark harness for real-worker + WASM + dataset fitness evaluation
 * (Issue #2261).
 *
 * Unlike `ParallelFitnessEvaluation.ts` which uses mock workers, this
 * harness exercises the full production path: real `WorkerHandler` instances
 * (in direct/mock-transport mode) running `evaluateDir` against on-disk
 * binary datasets with WASM activation scoring.
 *
 * Three creature topology sizes are tested:
 *   - **Small**:  2 hidden neurons, 4 synapses   (minimal network)
 *   - **Medium**: 10 hidden neurons, 25 synapses  (typical early evolution)
 *   - **Large**:  30 hidden neurons, 90 synapses   (mature topology)
 *
 * The dataset contains 500 records (3 inputs, 2 outputs) partitioned across
 * multiple `.bin` files, matching production-like conditions.
 *
 * Results are suitable for regression comparison: re-run the same harness
 * after an optimisation and compare wall times.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-net --allow-ffi \
 *     bench/RealWorkerDatasetEvaluation.ts
 */
import { Creature, type CreatureExport } from "../mod.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { Fitness } from "@architecture/Fitness.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const INPUT_COUNT = 3;
const OUTPUT_COUNT = 2;
const DATASET_SIZE = 500;
const PARTITION_BREAK = 100;

/* ------------------------------------------------------------------ */
/*  Dataset generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate a deterministic synthetic dataset.
 *
 * Uses a simple linear-combination rule so that creature accuracy is
 * meaningful but irrelevant to the benchmark — we are measuring wall time,
 * not prediction quality.
 */
function generateDataset(): DataRecordInterface[] {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < DATASET_SIZE; i++) {
    const a = (i * 0.002) - 0.5;
    const b = ((i * 7) % DATASET_SIZE) * 0.002 - 0.5;
    const c = ((i * 13) % DATASET_SIZE) * 0.002 - 0.5;
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
/*  Creature topology builders                                         */
/* ------------------------------------------------------------------ */

/** Small topology: 2 hidden neurons, 4 synapses. */
function buildSmallCreature(): CreatureExport {
  return {
    input: INPUT_COUNT,
    output: OUTPUT_COUNT,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "h-1", squash: "TANH", bias: -0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: -0.3 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "h-1", toUUID: "output-1", weight: 0.6 },
    ],
  };
}

/** Medium topology: 10 hidden neurons, ~25 synapses. */
function buildMediumCreature(): CreatureExport {
  const neurons = [];
  const synapses = [];

  // Create 10 hidden neurons in two layers.
  for (let i = 0; i < 10; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `h-${i}`,
      squash: i % 2 === 0 ? "TANH" : "RELU" as string,
      bias: (i - 5) * 0.05,
    });
  }
  neurons.push(
    { type: "output" as const, uuid: "output-0", squash: "IDENTITY", bias: 0 },
    { type: "output" as const, uuid: "output-1", squash: "IDENTITY", bias: 0 },
  );

  // Layer 1: inputs -> first 5 hidden neurons (15 synapses).
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < INPUT_COUNT; j++) {
      synapses.push({
        fromUUID: `input-${j}`,
        toUUID: `h-${i}`,
        weight: ((i + j) % 7 - 3) * 0.2,
      });
    }
  }

  // Layer 2: first 5 -> next 5 hidden neurons (5 synapses, sparse).
  for (let i = 0; i < 5; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `h-${i + 5}`,
      weight: (i % 3 - 1) * 0.4,
    });
  }

  // Output connections from layer 2 (5 synapses, alternating outputs).
  for (let i = 5; i < 10; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `output-${i % OUTPUT_COUNT}`,
      weight: (i % 5 - 2) * 0.3,
    });
  }

  return { input: INPUT_COUNT, output: OUTPUT_COUNT, neurons, synapses };
}

/** Large topology: 30 hidden neurons, ~90 synapses. */
function buildLargeCreature(): CreatureExport {
  const neurons = [];
  const synapses = [];
  const squashes = ["TANH", "RELU", "LOGISTIC", "IDENTITY"];

  // 30 hidden neurons across three layers of 10.
  for (let i = 0; i < 30; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `h-${i}`,
      squash: squashes[i % squashes.length],
      bias: ((i * 7) % 11 - 5) * 0.03,
    });
  }
  neurons.push(
    { type: "output" as const, uuid: "output-0", squash: "IDENTITY", bias: 0 },
    { type: "output" as const, uuid: "output-1", squash: "IDENTITY", bias: 0 },
  );

  // Layer 1: inputs -> hidden[0..9] (30 synapses).
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < INPUT_COUNT; j++) {
      synapses.push({
        fromUUID: `input-${j}`,
        toUUID: `h-${i}`,
        weight: ((i + j * 3) % 9 - 4) * 0.15,
      });
    }
  }

  // Layer 2: hidden[0..9] -> hidden[10..19] (30 synapses, 3 per target).
  for (let i = 10; i < 20; i++) {
    for (let s = 0; s < 3; s++) {
      const from = (i + s * 3) % 10;
      synapses.push({
        fromUUID: `h-${from}`,
        toUUID: `h-${i}`,
        weight: ((from + i) % 7 - 3) * 0.2,
      });
    }
  }

  // Layer 3: hidden[10..19] -> hidden[20..29] (20 synapses, 2 per target).
  for (let i = 20; i < 30; i++) {
    for (let s = 0; s < 2; s++) {
      const from = 10 + ((i + s * 4) % 10);
      synapses.push({
        fromUUID: `h-${from}`,
        toUUID: `h-${i}`,
        weight: ((from * i) % 11 - 5) * 0.1,
      });
    }
  }

  // Output: hidden[20..29] -> outputs (10 synapses).
  for (let i = 20; i < 30; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `output-${i % OUTPUT_COUNT}`,
      weight: (i % 5 - 2) * 0.25,
    });
  }

  return { input: INPUT_COUNT, output: OUTPUT_COUNT, neurons, synapses };
}

/* ------------------------------------------------------------------ */
/*  Shared fixture setup                                               */
/* ------------------------------------------------------------------ */

const dataset = generateDataset();
const dataSetDir = makeDataDir(dataset, PARTITION_BREAK);

/**
 * Helper: create a `Fitness` instance backed by real `WorkerHandler`(s)
 * in direct mode (in-process mock transport, real WASM evaluation).
 */
function createRealFitness(workerCount: number): {
  fitness: Fitness;
  workers: WorkerHandler[];
} {
  const workers: WorkerHandler[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(new WorkerHandler(dataSetDir, "MSE", true));
  }
  const fitness = new Fitness(workers, 0.0001, false);
  return { fitness, workers };
}

/** Build a unique `Creature` from an export, assigning a fresh UUID. */
function prepareCreature(json: CreatureExport): Creature {
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

/* ------------------------------------------------------------------ */
/*  Benchmarks                                                         */
/* ------------------------------------------------------------------ */

// --- Small topology ---------------------------------------------------

Deno.bench({
  name: "small topology (2 hidden), 1 worker",
  group: "small topology",
  baseline: true,
  async fn() {
    const { fitness } = createRealFitness(1);
    const creature = prepareCreature(buildSmallCreature());
    await fitness.calculate([creature]);
  },
});

Deno.bench({
  name: "small topology (2 hidden), 2 workers",
  group: "small topology",
  async fn() {
    const { fitness } = createRealFitness(2);
    const creatures = [
      prepareCreature(buildSmallCreature()),
      prepareCreature(buildSmallCreature()),
    ];
    await fitness.calculate(creatures);
  },
});

// --- Medium topology --------------------------------------------------

Deno.bench({
  name: "medium topology (10 hidden), 1 worker",
  group: "medium topology",
  baseline: true,
  async fn() {
    const { fitness } = createRealFitness(1);
    const creature = prepareCreature(buildMediumCreature());
    await fitness.calculate([creature]);
  },
});

Deno.bench({
  name: "medium topology (10 hidden), 2 workers",
  group: "medium topology",
  async fn() {
    const { fitness } = createRealFitness(2);
    const creatures = [
      prepareCreature(buildMediumCreature()),
      prepareCreature(buildMediumCreature()),
    ];
    await fitness.calculate(creatures);
  },
});

// --- Large topology ---------------------------------------------------

Deno.bench({
  name: "large topology (30 hidden), 1 worker",
  group: "large topology",
  baseline: true,
  async fn() {
    const { fitness } = createRealFitness(1);
    const creature = prepareCreature(buildLargeCreature());
    await fitness.calculate([creature]);
  },
});

Deno.bench({
  name: "large topology (30 hidden), 2 workers",
  group: "large topology",
  async fn() {
    const { fitness } = createRealFitness(2);
    const creatures = [
      prepareCreature(buildLargeCreature()),
      prepareCreature(buildLargeCreature()),
    ];
    await fitness.calculate(creatures);
  },
});

// --- Population batch (mixed topologies) ------------------------------

Deno.bench({
  name: "mixed population (10 creatures), 1 worker",
  group: "mixed population",
  baseline: true,
  async fn() {
    const { fitness } = createRealFitness(1);
    const population = [
      ...Array.from({ length: 4 }, () => prepareCreature(buildSmallCreature())),
      ...Array.from(
        { length: 4 },
        () => prepareCreature(buildMediumCreature()),
      ),
      ...Array.from(
        { length: 2 },
        () => prepareCreature(buildLargeCreature()),
      ),
    ];
    await fitness.calculate(population);
  },
});

Deno.bench({
  name: "mixed population (10 creatures), 2 workers",
  group: "mixed population",
  async fn() {
    const { fitness } = createRealFitness(2);
    const population = [
      ...Array.from({ length: 4 }, () => prepareCreature(buildSmallCreature())),
      ...Array.from(
        { length: 4 },
        () => prepareCreature(buildMediumCreature()),
      ),
      ...Array.from(
        { length: 2 },
        () => prepareCreature(buildLargeCreature()),
      ),
    ];
    await fitness.calculate(population);
  },
});

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

addEventListener("unload", () => {
  try {
    Deno.removeSync(dataSetDir, { recursive: true });
  } catch {
    // Best-effort cleanup.
  }
});
