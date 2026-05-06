/**
 * Issue #2529 — Muon vs baseline backprop benchmark.
 *
 * Compares wall-clock per-step training time and steps-to-convergence
 * with `gradientOrthogonalisation = "none"` (baseline) versus `"muon"`
 * on a fixed creature. The Muon mode applies Newton-Schulz orthogonalised
 * gradient updates per topological layer.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-write \
 *     bench/MuonVsBaseline.ts
 *
 * The benchmark builds a small two-hidden-layer creature and trains
 * against a fixed input/target pair until either the target error is
 * reached or `MAX_ITERATIONS` elapses.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

const INPUT = new Float32Array([0.4, 0.7, 0.1, 0.9]);
const TARGET = new Float32Array([0.3, 0.6]);
const TARGET_ERROR = 0.01;
const MAX_ITERATIONS = 500;
const TRIALS = 5;

interface BenchResult {
  mode: "none" | "muon";
  meanItersToTarget: number;
  meanWallClockMsPerStep: number;
  meanFinalError: number;
  hits: number; // out of TRIALS
}

function createCreature(): Creature {
  // Two hidden neurons sharing the same input fan-in count → ideal
  // candidates for per-layer Muon orthogonalisation.
  const json: CreatureExport = {
    input: 4,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: -0.1 },
      { type: "hidden", uuid: "h2", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // input → first hidden layer (4 × 2 = 8 synapses).
      { fromUUID: "input-0", toUUID: "h0", weight: 0.20 },
      { fromUUID: "input-1", toUUID: "h0", weight: -0.15 },
      { fromUUID: "input-2", toUUID: "h0", weight: 0.30 },
      { fromUUID: "input-3", toUUID: "h0", weight: -0.05 },
      { fromUUID: "input-0", toUUID: "h1", weight: -0.10 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.25 },
      { fromUUID: "input-2", toUUID: "h1", weight: -0.20 },
      { fromUUID: "input-3", toUUID: "h1", weight: 0.10 },
      // first hidden → second hidden layer (2 × 2 = 4 synapses).
      { fromUUID: "h0", toUUID: "h2", weight: 0.40 },
      { fromUUID: "h1", toUUID: "h2", weight: -0.30 },
      { fromUUID: "h0", toUUID: "h3", weight: -0.20 },
      { fromUUID: "h1", toUUID: "h3", weight: 0.50 },
      // second hidden → output (2 × 2 = 4 synapses).
      { fromUUID: "h2", toUUID: "output-0", weight: 0.50 },
      { fromUUID: "h3", toUUID: "output-0", weight: -0.30 },
      { fromUUID: "h2", toUUID: "output-1", weight: -0.20 },
      { fromUUID: "h3", toUUID: "output-1", weight: 0.40 },
    ],
  };
  return Creature.fromJSON(json);
}

function meanError(output: number[]): number {
  let s = 0;
  for (let i = 0; i < TARGET.length; i++) {
    const d = output[i] - TARGET[i];
    s += d * d;
  }
  return Math.sqrt(s / TARGET.length);
}

function runTrial(mode: "none" | "muon"): {
  iters: number;
  wallClockMs: number;
  finalError: number;
  hit: boolean;
} {
  const creature = createCreature();
  const config = createBackPropagationConfig({
    generations: 0,
    disableRandomSamples: true,
    batchSize: 1,
    learningRate: 0.05,
    learningRateStrategy: "fixed",
    gradientOrthogonalisation: mode,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  let iters = 0;
  let finalError = Number.POSITIVE_INFINITY;
  let hit = false;

  const start = performance.now();
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    creature.activateAndTrace(INPUT, false, sparseConfig);
    creature.propagate(TARGET, config, sparseConfig);
    // Commit accumulated batch state so the next activation sees the
    // updated weights — without this the bench measures nothing.
    creature.propagateUpdate(config, sparseConfig);
    iters++;

    const output = creature.activate(INPUT);
    finalError = meanError(Array.from(output));
    if (finalError <= TARGET_ERROR) {
      hit = true;
      break;
    }
  }
  const wallClockMs = performance.now() - start;
  creature.clearState();

  return { iters, wallClockMs, finalError, hit };
}

function bench(mode: "none" | "muon"): BenchResult {
  const iters: number[] = [];
  const wallClock: number[] = [];
  const finalErrors: number[] = [];
  let hits = 0;
  for (let t = 0; t < TRIALS; t++) {
    const r = runTrial(mode);
    iters.push(r.iters);
    wallClock.push(r.wallClockMs / Math.max(1, r.iters));
    finalErrors.push(r.finalError);
    if (r.hit) hits++;
  }
  const mean = (xs: number[]) =>
    xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    mode,
    meanItersToTarget: mean(iters),
    meanWallClockMsPerStep: mean(wallClock),
    meanFinalError: mean(finalErrors),
    hits,
  };
}

if (import.meta.main) {
  console.log("Issue #2529 — Muon vs baseline backprop convergence");
  console.log(`Trials per mode: ${TRIALS}`);
  console.log(
    `Target error: ${TARGET_ERROR}, max iterations: ${MAX_ITERATIONS}\n`,
  );

  const baseline = bench("none");
  const muon = bench("muon");

  const fmt = (r: BenchResult) =>
    `  ${r.mode.padEnd(6)} | hits=${r.hits}/${TRIALS} | iters=${
      r.meanItersToTarget.toFixed(1)
    } | ` +
    `ms/step=${r.meanWallClockMsPerStep.toFixed(3)} | finalErr=${
      r.meanFinalError.toFixed(5)
    }`;

  console.log("mode   | hits      | iters  | ms/step | final error");
  console.log("-------+-----------+--------+---------+-------------");
  console.log(fmt(baseline));
  console.log(fmt(muon));
}
