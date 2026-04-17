/**
 * Benchmark for pipelined binary file scoring (Issue #2331).
 *
 * Measures the wall-clock improvement from double-buffered async I/O
 * in `evaluateDir`. Tests with many small files (500+ records across
 * 50+ `.bin` files) to exercise both the within-file pipelining and
 * cross-file prefetch paths.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-net --allow-ffi \
 *     bench/PipelinedBinaryScoring.ts
 */
import { Creature, type CreatureExport } from "../mod.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { Costs } from "@costs";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const INPUT_COUNT = 3;
const OUTPUT_COUNT = 2;
const DATASET_SIZE = 600;

/* ------------------------------------------------------------------ */
/*  Dataset generation                                                 */
/* ------------------------------------------------------------------ */

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
/*  Creature topology                                                  */
/* ------------------------------------------------------------------ */

function buildMediumCreature(): CreatureExport {
  const neurons = [];
  const synapses = [];

  for (let i = 0; i < 10; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `h-${i}`,
      squash: i % 2 === 0 ? "TANH" : "RELU" as string,
      bias: (i - 5) * 0.05,
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

  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < INPUT_COUNT; j++) {
      synapses.push({
        fromUUID: `input-${j}`,
        toUUID: `h-${i}`,
        weight: ((i + j) % 7 - 3) * 0.2,
      });
    }
  }
  for (let i = 0; i < 5; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `h-${i + 5}`,
      weight: (i % 3 - 1) * 0.4,
    });
  }
  for (let i = 5; i < 10; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `output-${i % OUTPUT_COUNT}`,
      weight: (i % 5 - 2) * 0.3,
    });
  }

  return { input: INPUT_COUNT, output: OUTPUT_COUNT, neurons, synapses };
}

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                    */
/* ------------------------------------------------------------------ */

const dataset = generateDataset();

// Many small files: 10 records per file = 60 files
const manyFilesDir = makeDataDir(dataset, 10);
// Few large files: 300 records per file = 2 files
const fewFilesDir = makeDataDir(dataset, 300);

const cost = Costs.find("MSE");

/* ------------------------------------------------------------------ */
/*  Benchmarks                                                         */
/* ------------------------------------------------------------------ */

Deno.bench({
  name: "evaluateDir: 60 small files (10 records each), medium topology",
  group: "pipelined-scoring",
  baseline: true,
  async fn() {
    const creature = Creature.fromJSON(buildMediumCreature());
    try {
      await creature.evaluateDir(manyFilesDir, cost, false);
    } finally {
      creature.dispose();
    }
  },
});

Deno.bench({
  name: "evaluateDir: 2 large files (300 records each), medium topology",
  group: "pipelined-scoring",
  async fn() {
    const creature = Creature.fromJSON(buildMediumCreature());
    try {
      await creature.evaluateDir(fewFilesDir, cost, false);
    } finally {
      creature.dispose();
    }
  },
});

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

addEventListener("unload", () => {
  try {
    Deno.removeSync(manyFilesDir, { recursive: true });
    Deno.removeSync(fewFilesDir, { recursive: true });
  } catch {
    // Best-effort cleanup.
  }
});
