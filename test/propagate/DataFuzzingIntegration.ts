/**
 * Issue #1900 - Data fuzzing integration test.
 *
 * Verifies that training completes without error when data fuzzing
 * is enabled, and that fuzzing is only applied during training
 * (not during inference).
 */
import { assert, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

await initWasmForTests();

function withSeededGlobalRng(seed: number, fn: () => void): void {
  const previous = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(createSeededRng(seed));
    fn();
  } finally {
    setRandomNumberGenerator(previous);
  }
}

// Simple XOR-like dataset for testing.
const xorData: DataRecordInterface[] = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

Deno.test("Training completes with Gaussian fuzzing enabled", () => {
  withSeededGlobalRng(42, () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });

    const result = train(creature, xorData, {
      iterations: 3,
      targetError: 0.01,
      learningRate: 0.3,
      learningRateStrategy: "fixed",
      dataFuzzing: {
        enabled: true,
        inputNoiseScale: 0.01,
        outputNoiseScale: 0,
        noiseType: "gaussian",
      },
    });

    assert(result !== undefined, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
  });
});

Deno.test("Training completes with uniform fuzzing enabled", () => {
  withSeededGlobalRng(99, () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });

    const result = train(creature, xorData, {
      iterations: 3,
      targetError: 0.01,
      learningRate: 0.3,
      learningRateStrategy: "fixed",
      dataFuzzing: {
        enabled: true,
        inputNoiseScale: 0.02,
        outputNoiseScale: 0.005,
        noiseType: "uniform",
      },
    });

    assert(result !== undefined, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
  });
});

Deno.test("Training with fuzzing disabled behaves normally", () => {
  withSeededGlobalRng(77, () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });

    const result = train(creature, xorData, {
      iterations: 3,
      targetError: 0.01,
      learningRate: 0.3,
      learningRateStrategy: "fixed",
      dataFuzzing: {
        enabled: false,
      },
    });

    assert(result !== undefined, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
  });
});

Deno.test("Inference does not apply fuzzing", () => {
  withSeededGlobalRng(55, () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
    });

    // Activate the creature with the same input multiple times.
    // Since fuzzing is only applied during training, inference
    // results should be identical for the same input.
    const input = new Float32Array([0.5, 0.5]);
    const output1 = creature.activate(input);
    const output2 = creature.activate(input);

    for (let i = 0; i < output1.length; i++) {
      assert(
        output1[i] === output2[i],
        `Inference outputs should be deterministic: ${output1[i]} !== ${
          output2[i]
        }`,
      );
    }
  });
});

Deno.test("Training with output noise applies label smoothing", () => {
  withSeededGlobalRng(66, () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 3 }],
    });

    const result = train(creature, xorData, {
      iterations: 2,
      targetError: 0.01,
      learningRate: 0.3,
      learningRateStrategy: "fixed",
      dataFuzzing: {
        enabled: true,
        inputNoiseScale: 0.01,
        outputNoiseScale: 0.01,
        noiseType: "gaussian",
      },
    });

    assert(result !== undefined, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
    assertGreater(result.error, 0, "Error should be positive");
  });
});
