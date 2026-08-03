/**
 * Issue #3638 — Shared Lamarckian-evolution benchmark harness.
 *
 * The pace/convergence experiment family (`bench/EvolutionPaceLeverComparison.ts`,
 * `bench/ProductionPaceLeverBakeOff.ts`, `bench/TrainPerGenConvergence.ts`) is only
 * comparable while every member solves the **same** problem, trains a candidate the
 * **same** way, and scores it with the **same** metric. That shared knowledge used to
 * be copy-pasted into all three benches, so a corrected backprop setting or a different
 * teacher non-linearity would silently break comparability unless all three were edited
 * together. It now lives here, once:
 *
 *   - **Teacher problem** — targets are `logistic(Σ wᵢxᵢ)`, with teacher weights and
 *     sample inputs drawn uniformly from `[-1, 1)`.
 *   - **Fitness** — mean absolute error over every sample and output.
 *   - **One Lamarckian step** — `activateAndTrace` / `propagate` over the dataset for
 *     `innerIters` inner iterations, then `applyLearnings`, under a fixed backprop
 *     config (`plankConstant: 1e-7`, unit adjustment scales, `disableRandomSamples`,
 *     `batchSize: 1`).
 *   - **Perturbation** — jitters every synapse weight and neuron bias by `±scale`.
 *
 * Each benchmark keeps its own constants and passes them in. A future experiment that
 * deliberately needs a different teacher should write its own generator rather than
 * growing this one.
 */

import { Creature } from "@creature";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

/** One supervised training example: an input vector and its teacher target. */
export interface Sample {
  readonly input: Float32Array;
  readonly target: Float32Array;
}

/** Shape of the synthetic teacher problem. */
export interface TeacherDatasetOptions {
  readonly inputs: number;
  readonly outputs: number;
  readonly datasetSize: number;
}

/** Guards a count that must be a positive integer, failing loud on misuse. */
function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got: ${value}`);
  }
}

/**
 * Builds the fixed supervised problem the pace experiments are solved against:
 * a random logistic teacher, `datasetSize` samples deep.
 *
 * Deterministic for a deterministic `rng`, and draws exactly
 * `outputs × inputs + datasetSize × inputs` numbers so callers sharing one seeded
 * stream stay reproducible.
 */
export function buildTeacherDataset(
  rng: () => number,
  opts: TeacherDatasetOptions,
): Sample[] {
  assertPositiveInt("inputs", opts.inputs);
  assertPositiveInt("outputs", opts.outputs);
  assertPositiveInt("datasetSize", opts.datasetSize);

  const targetW: number[][] = Array.from(
    { length: opts.outputs },
    () => Array.from({ length: opts.inputs }, () => rng() * 2 - 1),
  );
  const logistic = (x: number) => 1 / (1 + Math.exp(-x));

  const samples: Sample[] = [];
  for (let s = 0; s < opts.datasetSize; s++) {
    const input = new Float32Array(opts.inputs);
    for (let i = 0; i < opts.inputs; i++) input[i] = rng() * 2 - 1;
    const target = new Float32Array(opts.outputs);
    for (let o = 0; o < opts.outputs; o++) {
      let sum = 0;
      for (let i = 0; i < opts.inputs; i++) sum += targetW[o][i] * input[i];
      target[o] = logistic(sum);
    }
    samples.push({ input, target });
  }
  return samples;
}

/** Fitness for the experiment family: mean absolute error over samples × outputs. */
export function meanAbsoluteError(
  creature: Creature,
  data: readonly Sample[],
  outputs: number,
): number {
  let total = 0;
  for (const { input, target } of data) {
    const out = creature.activate(input);
    for (let o = 0; o < outputs; o++) total += Math.abs(out[o] - target[o]);
  }
  return total / (data.length * outputs);
}

/**
 * Runs one Lamarckian (memetic) training step over the whole dataset, mutating
 * `creature` in place: `innerIters` passes of `activateAndTrace` + `propagate`,
 * followed by a single `applyLearnings`.
 */
export function trainOneGeneration(
  creature: Creature,
  data: readonly Sample[],
  learningRate: number,
  innerIters: number,
): void {
  const json = creature.exportJSON();
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  });
  const sparse = new SparseConfig(json, config);
  for (let iter = 0; iter < innerIters; iter++) {
    for (const { input, target } of data) {
      creature.activateAndTrace(input, false, sparse);
      creature.propagate(target, config, sparse);
    }
  }
  creature.applyLearnings(config, sparse);
}

/**
 * Returns a copy of `source` with every synapse weight and neuron bias jittered
 * by `±scale`. `source` is left untouched.
 */
export function perturb(
  source: Creature,
  rng: () => number,
  scale: number,
): Creature {
  const json = source.exportJSON();
  for (const s of json.synapses) s.weight += (rng() * 2 - 1) * scale;
  for (const n of json.neurons) {
    if (typeof n.bias === "number") n.bias += (rng() * 2 - 1) * scale;
  }
  return Creature.fromJSON(json);
}
