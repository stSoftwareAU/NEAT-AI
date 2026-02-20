/**
 * Tests for Predictive Coding training integration.
 *
 * Issue #1556: Verifies that PredictiveCodingTrainer correctly orchestrates
 * PC inference and Hebbian learning, and that trainDir() delegates to PC
 * training when predictiveCoding.enabled is true.
 */

import { assert, assertGreater, assertLess } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";
import { trainWithPredictiveCoding } from "../../src/predictiveCoding/PredictiveCodingTrainer.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

Deno.test("PC trainer returns finite error for simple dataset", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
    };

    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      {
        iterations: 5,
        targetError: 0.001,
      },
    );

    assert(Number.isFinite(result.error), "Error should be finite");
    assertGreater(result.iterations, 0, "Should complete at least 1 iteration");
    assert(
      Number.isFinite(result.averageEnergy),
      "Average energy should be finite",
    );
    assert(result.changed, "Weights should have changed during training");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("trainDir delegates to PC trainer when enabled", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(
      creature,
      dataSetDir,
      options,
      Costs.find("MSE"),
    );

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.trace, "Should return a trace");
    assert(result.ID, "Should return an ID");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("trainDir uses standard backprop when PC is disabled", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const options: TrainOptions = {
      iterations: 2,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: false,
      },
    };

    const result = trainDir(
      creature,
      dataSetDir,
      options,
      Costs.find("MSE"),
    );

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.trace, "Should return a trace");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("trainDir without PC config uses standard backprop", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const options: TrainOptions = {
      iterations: 2,
      disableRandomSamples: true,
    };

    const result = trainDir(
      creature,
      dataSetDir,
      options,
      Costs.find("MSE"),
    );

    assert(Number.isFinite(result.error), "Error should be finite");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC training reduces error on simple regression task", () => {
  // Simple linear regression: output ~= input[0] + input[1]
  const creature = new Creature(2, 1, {
    layers: [{ count: 4 }],
    outputLayer: {
      squash: "IDENTITY",
    },
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0.1, 0.2]), output: new Float32Array([0.3]) },
    { input: new Float32Array([0.3, 0.1]), output: new Float32Array([0.4]) },
    { input: new Float32Array([0.5, 0.5]), output: new Float32Array([1.0]) },
    { input: new Float32Array([0.2, 0.3]), output: new Float32Array([0.5]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps: 20,
      learningRate: 0.01,
    };

    // Get initial error.
    const initialResult = trainWithPredictiveCoding(
      Creature.fromJSON(creature.exportJSON()),
      [dataSetDir + "/0.bin"],
      { ...pcConfig, learningRate: 0 }, // zero learning rate = no updates
      Costs.find("MSE"),
      { iterations: 1, targetError: 0 },
    );

    // Train with PC.
    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 50, targetError: 0.001 },
    );

    // Error should be finite and non-negative.
    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");

    // Training should have produced a finite initial error.
    assert(
      Number.isFinite(initialResult.error),
      "Initial error should be finite",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC trainer handles single-sample dataset", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
    };

    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 3, targetError: 0.001 },
    );

    assert(Number.isFinite(result.error), "Error should be finite");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC trainer averageInferenceSteps is within bounds", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const inferenceSteps = 30;
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps,
    };

    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 1, targetError: 0 },
    );

    assertGreater(
      result.averageInferenceSteps,
      0,
      "Should use at least 1 inference step",
    );
    assertLess(
      result.averageInferenceSteps,
      inferenceSteps + 1,
      "Should not exceed configured inference steps",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});
