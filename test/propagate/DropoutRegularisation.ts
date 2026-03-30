/**
 * Issue #1860 - True dropout regularisation during training.
 *
 * Tests that inverted dropout is correctly applied to hidden neuron
 * activations during training, and that inference uses all neurons.
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { applyDropout } from "@propagate/Dropout.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

await initWasmForTests();

/**
 * Helper: create a creature and populate its state.activations manually
 * so that applyDropout can be tested in isolation.
 */
function makeCreatureWithActivations(
  inputCount: number,
  hiddenCount: number,
  outputCount: number,
): Creature {
  const creature = new Creature(inputCount, outputCount, {
    layers: [{ count: hiddenCount }],
  });

  // Manually initialise the activations array with known values
  const totalNeurons = creature.neurons.length;
  creature.state.makeActivation(
    new Float32Array(inputCount).fill(1),
    false,
  );

  // Set hidden neuron activations to non-zero values
  for (let i = inputCount; i < totalNeurons - outputCount; i++) {
    creature.state.activations[i] = 0.5 + i * 0.1;
  }
  // Set output neuron activations
  for (let i = totalNeurons - outputCount; i < totalNeurons; i++) {
    creature.state.activations[i] = 0.8;
  }

  return creature;
}

// ---------------------------------------------------------------------------
// Configuration defaults
// ---------------------------------------------------------------------------

Deno.test("Dropout rate defaults to 0 (disabled)", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.1,
    learningRateStrategy: "fixed",
  });
  assertEquals(config.dropoutRate, 0);
});

Deno.test("Dropout rate is clamped between 0 and 1", () => {
  const negativeConfig = createBackPropagationConfig({
    dropoutRate: -0.5,
  });
  assertEquals(negativeConfig.dropoutRate, 0);

  const overConfig = createBackPropagationConfig({
    dropoutRate: 1.5,
  });
  assertEquals(overConfig.dropoutRate, 1);
});

Deno.test("Dropout rate of 0.5 is preserved in config", () => {
  const config = createBackPropagationConfig({
    dropoutRate: 0.5,
  });
  assertAlmostEquals(config.dropoutRate, 0.5, 1e-9);
});

// ---------------------------------------------------------------------------
// applyDropout unit tests
// ---------------------------------------------------------------------------

Deno.test("applyDropout with rate 0 does not change activations", () => {
  const rng = createSeededRng(42);
  const creature = makeCreatureWithActivations(2, 4, 1);

  const before = Float32Array.from(creature.state.activations);
  const dropped = applyDropout(creature, 0, rng);
  assertEquals(dropped, 0);

  for (let i = 0; i < before.length; i++) {
    assertAlmostEquals(creature.state.activations[i], before[i], 1e-6);
  }
});

Deno.test("applyDropout with rate 1 is a no-op (boundary)", () => {
  const rng = createSeededRng(42);
  const creature = makeCreatureWithActivations(2, 4, 1);

  const before = Float32Array.from(creature.state.activations);
  const dropped = applyDropout(creature, 1.0, rng);
  assertEquals(dropped, 0);

  for (let i = 0; i < before.length; i++) {
    assertAlmostEquals(creature.state.activations[i], before[i], 1e-6);
  }
});

Deno.test("applyDropout zeroes some hidden neurons with rate 0.5", () => {
  const rng = createSeededRng(42);
  const creature = makeCreatureWithActivations(2, 10, 1);

  const inputCount = creature.input;
  const outputCount = creature.output;
  const hiddenEnd = creature.neurons.length - outputCount;

  const dropped = applyDropout(creature, 0.5, rng);

  // With 10 hidden neurons and rate 0.5, expect some dropped
  assertGreater(dropped, 0);
  assertLess(dropped, 10);

  // Check that dropped neurons have activation 0
  let zeroCount = 0;
  for (let i = inputCount; i < hiddenEnd; i++) {
    if (creature.state.activations[i] === 0) {
      zeroCount++;
    }
  }
  assertEquals(zeroCount, dropped);
});

Deno.test("applyDropout applies inverted scaling to kept neurons", () => {
  const rng = createSeededRng(123);
  const creature = makeCreatureWithActivations(2, 20, 1);

  const inputCount = creature.input;
  const outputCount = creature.output;
  const hiddenEnd = creature.neurons.length - outputCount;
  const dropoutRate = 0.3;
  const scale = 1 / (1 - dropoutRate);

  const originalActivations = Float32Array.from(creature.state.activations);

  applyDropout(creature, dropoutRate, rng);

  // For kept neurons, activation should be original * scale
  let keptCount = 0;
  for (let i = inputCount; i < hiddenEnd; i++) {
    const current = creature.state.activations[i];
    if (current !== 0) {
      const expected = originalActivations[i] * scale;
      assertAlmostEquals(current, expected, 1e-5);
      keptCount++;
    }
  }
  // At least some should be kept
  assertGreater(keptCount, 0);
});

Deno.test("applyDropout does not modify input neurons", () => {
  const rng = createSeededRng(42);
  const creature = makeCreatureWithActivations(3, 5, 1);

  const inputBefore = Float32Array.from(
    creature.state.activations.subarray(0, creature.input),
  );

  applyDropout(creature, 0.5, rng);

  for (let i = 0; i < creature.input; i++) {
    assertAlmostEquals(
      creature.state.activations[i],
      inputBefore[i],
      1e-6,
    );
  }
});

Deno.test("applyDropout does not modify output neurons", () => {
  const rng = createSeededRng(42);
  const creature = makeCreatureWithActivations(2, 5, 2);

  const outputStart = creature.neurons.length - creature.output;
  const outputBefore = Float32Array.from(
    creature.state.activations.subarray(outputStart),
  );

  applyDropout(creature, 0.5, rng);

  for (let i = 0; i < creature.output; i++) {
    assertAlmostEquals(
      creature.state.activations[outputStart + i],
      outputBefore[i],
      1e-6,
    );
  }
});

// ---------------------------------------------------------------------------
// Inference uses all neurons (no dropout)
// ---------------------------------------------------------------------------

Deno.test("Inference produces deterministic results without dropout", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 5 }],
  });

  const input = new Float32Array([0.7, 0.3]);

  // Multiple activations should produce the same result (no dropout)
  const result1 = creature.activate(input);
  const result2 = creature.activate(input);

  assertAlmostEquals(result1[0], result2[0], 1e-9);
});

// ---------------------------------------------------------------------------
// Dropout config coexists with sparseRatio and L1/L2
// ---------------------------------------------------------------------------

Deno.test("Dropout config coexists with sparseRatio and L1/L2", () => {
  const config = createBackPropagationConfig({
    sparseRatio: 0.5,
    l1WeightDecay: 0.01,
    l2WeightDecay: 0.01,
    dropoutRate: 0.3,
  });

  assertAlmostEquals(config.sparseRatio, 0.5, 1e-9);
  assertAlmostEquals(config.l1WeightDecay, 0.01, 1e-9);
  assertAlmostEquals(config.l2WeightDecay, 0.01, 1e-9);
  assertAlmostEquals(config.dropoutRate, 0.3, 1e-9);
});

// ---------------------------------------------------------------------------
// Training integration: dropout completes without errors
// ---------------------------------------------------------------------------

Deno.test("Dropout training completes and produces valid outputs", () => {
  const previousRng = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(createSeededRng(42));

    const dataSet: DataRecordInterface[] = [];
    const noiseRng = createSeededRng(99);

    // XOR-like patterns with noise to encourage overfitting
    const patterns = [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [0] },
    ];

    for (let repeat = 0; repeat < 5; repeat++) {
      for (const p of patterns) {
        const noise = (noiseRng.random() - 0.5) * 0.1;
        dataSet.push({
          input: new Float32Array(
            p.input.map((v) => v + (noiseRng.random() - 0.5) * 0.05),
          ),
          output: new Float32Array([
            Math.max(0, Math.min(1, p.output[0] + noise)),
          ]),
        });
      }
    }

    // Train WITH dropout
    const creatureDropout = new Creature(2, 1, {
      layers: [{ count: 8 }],
    });

    const dropoutResult = train(creatureDropout, dataSet, {
      iterations: 10,
      targetError: 0.001,
      learningRate: 0.1,
      learningRateStrategy: "fixed",
      disableRandomSamples: true,
      dropoutRate: 0.3,
    });

    // Should complete training (not crash) and produce finite error
    assert(Number.isFinite(dropoutResult.error));

    // Verify inference produces valid outputs after training with dropout
    for (const p of patterns) {
      const input = new Float32Array(p.input);
      const output = creatureDropout.activate(input);
      assert(
        Number.isFinite(output[0]),
        "Dropout creature output is not finite",
      );
    }
  } finally {
    setRandomNumberGenerator(previousRng);
  }
});

Deno.test(
  "Inference uses all neurons regardless of training dropout setting",
  () => {
    const previousRng = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(42));

      const creature = new Creature(2, 1, {
        layers: [{ count: 6 }],
      });

      const dataSet: DataRecordInterface[] = [
        { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
        { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
        { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
        { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
      ];

      train(creature, dataSet, {
        iterations: 5,
        targetError: 0.01,
        learningRate: 0.1,
        learningRateStrategy: "fixed",
        disableRandomSamples: true,
        dropoutRate: 0.5,
      });

      // After training, inference should be deterministic (no dropout applied)
      const input = new Float32Array([0.5, 0.5]);
      const result1 = creature.activate(input);
      const result2 = creature.activate(input);

      assertAlmostEquals(result1[0], result2[0], 1e-9);
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  },
);
