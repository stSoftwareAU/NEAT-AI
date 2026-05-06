/**
 * Issue #2528 — On-Policy Distillation breeding operator benchmark.
 *
 * Compares the offspring quality produced by the OPD operator
 * (`onPolicyDistillationBreed`) against the consensus output of the
 * teachers, versus a naive clone-and-no-train baseline (the same
 * student topology, but without distillation steps).
 *
 * Reports the mean MSE on a held-out calibration batch for both the
 * baseline (no distillation) and the OPD-distilled student.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-write bench/OnPolicyDistillationBreed.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  DEFAULT_OPD_CONFIG,
  type RequiredOpdConfig,
} from "@config/OpdConfig.ts";
import { onPolicyDistillationBreed } from "@breed/OnPolicyDistillationBreed.ts";

const TRIALS = 5;
const HOLDOUT_SAMPLES = 32;

function buildCreature(uuids: string[], weightSeed: number): Creature {
  const neurons: CreatureExport["neurons"] = uuids.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.05,
  }));
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  const synapses: CreatureExport["synapses"] = [];
  for (let i = 0; i < 2; i++) {
    for (let h = 0; h < uuids.length; h++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: uuids[h],
        weight: 0.4 + weightSeed * 0.05 - h * 0.1,
      });
    }
  }
  for (const u of uuids) {
    synapses.push({ fromUUID: u, toUUID: "output-0", weight: 0.5 });
  }
  return Creature.fromJSON({
    input: 2,
    output: 1,
    neurons,
    synapses,
    forwardOnly: true,
  });
}

function meanSquaredError(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return n === 0 ? 0 : sum / n;
}

function consensusMean(
  teachers: Creature[],
  input: Float32Array,
): Float32Array {
  const out = new Float32Array(teachers[0].output);
  for (const t of teachers) {
    const o = t.activate(input);
    for (let i = 0; i < out.length; i++) out[i] += o[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= teachers.length;
  return out;
}

function runTrial(opdSteps: number): {
  baselineError: number;
  opdError: number;
} {
  const teachers = [
    buildCreature(["t-A0", "t-A1", "t-A2"], 0),
    buildCreature(["t-B0", "t-B1", "t-B2"], 1),
    buildCreature(["t-C0", "t-C1", "t-C2"], 2),
  ];

  const config: RequiredOpdConfig = {
    ...DEFAULT_OPD_CONFIG,
    breedRate: 1,
    teacherCount: 3,
    distillationSteps: opdSteps,
    calibrationBatchSize: 16,
    learningRate: 0.05,
  };
  const baseline = onPolicyDistillationBreed(teachers, {
    ...config,
    distillationSteps: 0 + 1, // single-step warm-up only, effectively no learning
    learningRate: 1e-9, // negligible update
  });
  const trained = onPolicyDistillationBreed(teachers, config);

  if (!baseline || !trained) {
    return { baselineError: NaN, opdError: NaN };
  }

  // Evaluate both students on a fresh holdout calibration batch.
  let baselineSum = 0;
  let opdSum = 0;
  for (let i = 0; i < HOLDOUT_SAMPLES; i++) {
    const x = new Float32Array(2);
    x[0] = Math.random() * 2 - 1;
    x[1] = Math.random() * 2 - 1;
    const target = consensusMean(teachers, x);
    baselineSum += meanSquaredError(baseline.offspring.activate(x), target);
    opdSum += meanSquaredError(trained.offspring.activate(x), target);
  }
  return {
    baselineError: baselineSum / HOLDOUT_SAMPLES,
    opdError: opdSum / HOLDOUT_SAMPLES,
  };
}

function main(): void {
  const stepBudgets = [10, 50, 100];
  console.log("On-Policy Distillation breeding — calibration MSE benchmark");
  console.log(
    `Holdout samples: ${HOLDOUT_SAMPLES}, trials per budget: ${TRIALS}`,
  );
  console.log("---------------------------------------------------------");
  for (const steps of stepBudgets) {
    let baseline = 0;
    let opd = 0;
    for (let t = 0; t < TRIALS; t++) {
      const r = runTrial(steps);
      baseline += r.baselineError;
      opd += r.opdError;
    }
    baseline /= TRIALS;
    opd /= TRIALS;
    const reduction = baseline > 0 ? (1 - opd / baseline) * 100 : 0;
    console.log(
      `steps=${String(steps).padStart(3)}  baseline_MSE=${
        baseline.toFixed(6)
      }  opd_MSE=${opd.toFixed(6)}  reduction=${reduction.toFixed(1)}%`,
    );
  }
}

main();
