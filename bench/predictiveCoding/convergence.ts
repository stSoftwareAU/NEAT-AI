/**
 * Convergence benchmarks for Predictive Coding vs standard backpropagation.
 *
 * Issue #1558: Measures training convergence characteristics:
 * - XOR problem: PC vs backprop training error after fixed iterations
 * - Regression: PC vs backprop final error after fixed training budget
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/predictiveCoding/convergence.ts
 */

import { Creature } from "../../src/Creature.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

// ── XOR Data ─────────────────────────────────────────────────────────

const xorData: DataRecordInterface[] = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

// ── Regression Data ──────────────────────────────────────────────────

const regressionData: DataRecordInterface[] = [
  { input: new Float32Array([0.1, 0.2]), output: new Float32Array([0.3]) },
  { input: new Float32Array([0.3, 0.1]), output: new Float32Array([0.4]) },
  { input: new Float32Array([0.5, 0.5]), output: new Float32Array([1.0]) },
  { input: new Float32Array([0.2, 0.3]), output: new Float32Array([0.5]) },
  { input: new Float32Array([0.4, 0.6]), output: new Float32Array([1.0]) },
  { input: new Float32Array([0.7, 0.2]), output: new Float32Array([0.9]) },
  { input: new Float32Array([0.1, 0.8]), output: new Float32Array([0.9]) },
  { input: new Float32Array([0.6, 0.4]), output: new Float32Array([1.0]) },
];

// ── XOR Benchmarks ───────────────────────────────────────────────────

const TRAINING_ITERATIONS = 20;

Deno.bench({
  name: "XOR: Standard backprop training",
  group: "XOR convergence",
  baseline: true,
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(xorData, xorData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: TRAINING_ITERATIONS,
        disableRandomSamples: true,
      };

      trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});

Deno.bench({
  name: "XOR: Predictive Coding training",
  group: "XOR convergence",
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(xorData, xorData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: TRAINING_ITERATIONS,
        targetError: 0.001,
        disableRandomSamples: true,
        predictiveCoding: {
          ...DEFAULT_PREDICTIVE_CODING_CONFIG,
          enabled: true,
          inferenceSteps: 30,
          learningRate: 0.01,
        },
      };

      trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});

// ── Regression Benchmarks ────────────────────────────────────────────

Deno.bench({
  name: "Regression: Standard backprop training",
  group: "Regression convergence",
  baseline: true,
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 6 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(regressionData, regressionData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: TRAINING_ITERATIONS,
        disableRandomSamples: true,
      };

      trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});

Deno.bench({
  name: "Regression: Predictive Coding training",
  group: "Regression convergence",
  fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 6 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSetDir = makeDataDir(regressionData, regressionData.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: TRAINING_ITERATIONS,
        targetError: 0.001,
        disableRandomSamples: true,
        predictiveCoding: {
          ...DEFAULT_PREDICTIVE_CODING_CONFIG,
          enabled: true,
          inferenceSteps: 30,
          learningRate: 0.01,
        },
      };

      trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
});
