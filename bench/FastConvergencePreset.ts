/**
 * Issue #2930 - Benchmark: FAST_CONVERGENCE_PRESET convergence.
 *
 * Demonstrates that the curated {@link FAST_CONVERGENCE_PRESET} — which
 * bundles already-implemented but OFF-by-default pace levers (plateau
 * detection with a 2× stall mutation boost, adaptive population sizing,
 * tighter species-stagnation windows, an extra `trainPerGen` pass and a
 * little more elitism) — reaches a sample task's `targetError` in **fewer
 * generations** than the library defaults.
 *
 * Full evolution is stochastic (worker scheduling, memory-pressure
 * responses and wall-clock-sensitive plateau timing inject noise even
 * under a fixed seed), so a single seed is not a reliable signal. This
 * bench therefore runs several seeds and reports the mean generations to
 * reach `targetError`. The generation at which each run first crosses the
 * target is captured via the `onTrainingEvent` lifecycle callback.
 *
 * Run with:
 *   deno run --allow-read --allow-write --allow-env --allow-ffi --allow-run \
 *     bench/FastConvergencePreset.ts
 */

import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { FAST_CONVERGENCE_PRESET } from "@presets/Presets.ts";

// 3-bit parity — a classic harder, plateau-prone task (the output is the
// XOR of all three inputs). Unlike 2-input XOR, the library defaults
// routinely stall on it, which is exactly where the preset's pace levers
// (plateau escape, adaptive population, stagnation reclamation) earn their
// keep.
function parity3(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) {
        rows.push({
          input: new Float32Array([a, b, c]),
          output: new Float32Array([a ^ b ^ c]),
        });
      }
    }
  }
  return rows;
}

const TASK = parity3();
const INPUTS = 3;

const SEEDS = [11, 23, 37, 59, 71];
const TARGET_ERROR = 0.05;
const GENERATION_CAP = 200;

/** Run one evolution and return generations taken plus the final error. */
async function run(
  options: NeatOptions,
  seed: number,
): Promise<{ generations: number; error: number }> {
  let generations = 0;
  const creature = new Creature(INPUTS, 1, { layers: [{ count: 3 }] });

  const result = await creature.evolveDataSet(TASK, {
    ...options,
    seed,
    threads: 1,
    targetError: TARGET_ERROR,
    iterations: GENERATION_CAP,
    discoverySampleRate: -1, // keep the comparison free of FFI noise
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete") {
        generations = event.generation;
      }
    },
  });

  return { generations, error: result.error };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(
  `Fast Convergence preset benchmark (3-bit parity, ${SEEDS.length} seeds, ` +
    `target ${TARGET_ERROR}, cap ${GENERATION_CAP})\n`,
);

const baselineGens: number[] = [];
const fastGens: number[] = [];

for (const seed of SEEDS) {
  // Sequential by design: running evolutions concurrently would contend for
  // CPU and skew the generation comparison.
  // deno-lint-ignore no-await-in-loop
  const baseline = await run({}, seed);
  // deno-lint-ignore no-await-in-loop
  const fast = await run({ ...FAST_CONVERGENCE_PRESET }, seed);
  baselineGens.push(baseline.generations);
  fastGens.push(fast.generations);
  console.log(
    `seed ${String(seed).padStart(3)} → defaults ${
      String(baseline.generations).padStart(3)
    } gen (err ${baseline.error.toFixed(4)})  |  ` +
      `fast ${String(fast.generations).padStart(3)} gen (err ${
        fast.error.toFixed(4)
      })`,
  );
}

const baselineMean = mean(baselineGens);
const fastMean = mean(fastGens);

console.log("");
console.log(`Mean generations — defaults: ${baselineMean.toFixed(1)}`);
console.log(`Mean generations — fast    : ${fastMean.toFixed(1)}`);

const delta = baselineMean - fastMean;
if (delta > 0) {
  console.log(
    `\nFAST_CONVERGENCE_PRESET converged ${delta.toFixed(1)} generations ` +
      `sooner on average (${
        ((delta / baselineMean) * 100).toFixed(0)
      }% fewer).`,
  );
} else {
  console.log(
    `\nNo mean improvement (${baselineMean.toFixed(1)} → ${
      fastMean.toFixed(1)
    }).`,
  );
}
