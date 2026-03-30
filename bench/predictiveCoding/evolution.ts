/**
 * Structural evolution quality benchmarks for Predictive Coding.
 *
 * Issue #1558: Measures how PC training affects structural evolution:
 * - Topology efficiency: Network size comparison for equivalent training
 * - Training quality: Error reduction with PC vs without PC
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/predictiveCoding/evolution.ts
 */

import { Creature } from "@creature";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainWithPredictiveCoding } from "@predictiveCoding/PredictiveCodingTrainer.ts";
import { Costs } from "@costs";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";

// ── Training Data ────────────────────────────────────────────────────

const trainingData: DataRecordInterface[] = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

// ── Topology Efficiency Benchmarks ───────────────────────────────────

// Compare PC training on small vs medium-sized networks to see how
// network size affects PC training cost.

const TRAINING_ITERATIONS = 10;

Deno.bench({
  name: "Small topology PC training (4 hidden)",
  group: "PC topology efficiency",
  baseline: true,
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(trainingData, trainingData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const pcConfig = {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
        inferenceSteps: 30,
        learningRate: 0.01,
      };

      trainWithPredictiveCoding(
        creature,
        [dataSetDir + "/0.bin"],
        pcConfig,
        Costs.find("MSE"),
        { iterations: TRAINING_ITERATIONS, targetError: 0.001 },
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});

Deno.bench({
  name: "Medium topology PC training (8 hidden)",
  group: "PC topology efficiency",
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 8 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(trainingData, trainingData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const pcConfig = {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
        inferenceSteps: 30,
        learningRate: 0.01,
      };

      trainWithPredictiveCoding(
        creature,
        [dataSetDir + "/0.bin"],
        pcConfig,
        Costs.find("MSE"),
        { iterations: TRAINING_ITERATIONS, targetError: 0.001 },
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});

Deno.bench({
  name: "Large topology PC training (2 layers: 8+4 hidden)",
  group: "PC topology efficiency",
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 8 }, { count: 4 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(trainingData, trainingData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const pcConfig = {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
        inferenceSteps: 30,
        learningRate: 0.01,
      };

      trainWithPredictiveCoding(
        creature,
        [dataSetDir + "/0.bin"],
        pcConfig,
        Costs.find("MSE"),
        { iterations: TRAINING_ITERATIONS, targetError: 0.001 },
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});
