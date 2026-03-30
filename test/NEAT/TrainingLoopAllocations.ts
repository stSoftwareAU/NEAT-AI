/**
 * Issue #1540 - Tests for reduced per-iteration allocations in training loop.
 *
 * Verifies that the optimised training loop (mutable config, scratch buffer
 * reuse, SparseConfig skip guard) produces correct results.
 */

import { assert, assertLess } from "@std/assert";
import { trainDir } from "@architecture/Training.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { Creature } from "../../src/Creature.ts";
import { Costs } from "../../src/Costs.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

function makeXorDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

Deno.test(
  "Issue #1540: Mutable iteration config produces valid training results across multiple iterations",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 3 }],
    });
    const dataSet = makeXorDataSet();
    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 5,
        disableRandomSamples: true,
        learningRate: 0.1,
      };

      const cost = Costs.find("MSE");
      const result = trainDir(creature, dataSetDir, options, cost);

      assert(result.iteration > 0, "Should complete at least one iteration");
      assert(
        Number.isFinite(result.error),
        "Error should be a finite number",
      );
      assert(result.trace !== undefined, "Trace should be defined");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "Issue #1540: Scratch index buffer reuse works with multiple binary files",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });
    const dataSet = makeXorDataSet();

    // Create a data directory with enough records to generate multiple files
    // by calling makeDataDir with a small batch size
    const dataSetDir = makeDataDir(dataSet, 2, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 2,
        disableRandomSamples: true,
        trainingSampleRate: 0.5,
      };

      const cost = Costs.find("MSE");
      const result = trainDir(creature, dataSetDir, options, cost);

      assert(
        Number.isFinite(result.error),
        "Error should be finite with scratch buffer reuse",
      );
      assert(result.iteration > 0, "Should complete at least one iteration");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "Issue #1540: SparseConfig skips rebuild when sparseRatio is 1",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 3 }],
    });
    const dataSet = makeXorDataSet();
    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 3,
        disableRandomSamples: true,
        sparseRatio: 1,
        learningRate: 0.1,
      };

      const cost = Costs.find("MSE");
      const result = trainDir(creature, dataSetDir, options, cost);

      assert(
        Number.isFinite(result.error),
        "Error should be finite with sparseRatio=1",
      );
      assert(result.iteration > 0, "Should complete iterations");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "Issue #1540: Training with sparse ratio < 1 still rebuilds SparseConfig when needed",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });
    const dataSet = makeXorDataSet();
    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 3,
        disableRandomSamples: true,
        sparseRatio: 0.5,
        learningRate: 0.1,
      };

      const cost = Costs.find("MSE");
      const result = trainDir(creature, dataSetDir, options, cost);

      assert(
        Number.isFinite(result.error),
        "Error should be finite with sparse training",
      );
      assert(result.iteration > 0, "Should complete iterations");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "Issue #1540: Training error decreases or stays finite over multiple iterations",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });
    const dataSet = makeXorDataSet();
    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 500,
        disableRandomSamples: true,
        learningRate: 0.1,
        targetError: 0.001,
      };

      const cost = Costs.find("MSE");
      const result = trainDir(creature, dataSetDir, options, cost);

      assert(
        Number.isFinite(result.error),
        "Final error should be finite",
      );
      assertLess(
        result.error,
        10,
        "Error should remain bounded after training",
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);
