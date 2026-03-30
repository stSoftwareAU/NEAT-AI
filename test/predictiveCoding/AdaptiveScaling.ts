/**
 * Tests for adaptive scaling of Predictive Coding parameters.
 *
 * Issue #1915: Validates that PC parameters are scaled appropriately
 * for network topology, producing measurable gains on complex creatures
 * without manual tuning, while preserving behaviour for small networks.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { Creature } from "@creature";
import { computeEffectiveConfig } from "@predictiveCoding/AdaptiveScaling.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainWithPredictiveCoding } from "@predictiveCoding/PredictiveCodingTrainer.ts";
import { Costs } from "@costs";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

// -----------------------------------------------------------------------
// Test: Small network returns config unchanged
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: small network (≤10 hidden) returns config as-is", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 5 }],
  });

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const effective = computeEffectiveConfig(creature, config);

  assertAlmostEquals(
    effective.inferenceRate,
    config.inferenceRate,
    1e-15,
    "Inference rate should be unchanged for small networks",
  );
  assertAlmostEquals(
    effective.energyThreshold,
    config.energyThreshold,
    1e-15,
    "Energy threshold should be unchanged for small networks",
  );
  assertAlmostEquals(
    effective.learningRate,
    config.learningRate,
    1e-15,
    "Learning rate should be unchanged for small networks",
  );
});

// -----------------------------------------------------------------------
// Test: Large network scales inference rate down
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: large network scales inference rate down", () => {
  const creature = new Creature(4, 2, {
    layers: [
      { count: 12 },
      { count: 10 },
      { count: 8 },
      { count: 6 },
    ],
  });

  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(hiddenCount, 10, "Should have >10 hidden neurons");

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const effective = computeEffectiveConfig(creature, config);

  assertLess(
    effective.inferenceRate,
    config.inferenceRate,
    "Inference rate should be scaled down for large networks",
  );
  assertGreater(
    effective.inferenceRate,
    0,
    "Inference rate should remain positive",
  );
});

// -----------------------------------------------------------------------
// Test: Large network scales energy threshold up
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: large network scales energy threshold up", () => {
  const creature = new Creature(4, 2, {
    layers: [
      { count: 12 },
      { count: 10 },
      { count: 8 },
      { count: 6 },
    ],
  });

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const effective = computeEffectiveConfig(creature, config);

  assertGreater(
    effective.energyThreshold,
    config.energyThreshold,
    "Energy threshold should be scaled up for large networks",
  );
});

// -----------------------------------------------------------------------
// Test: Large network scales learning rate up
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: large network scales learning rate up", () => {
  const creature = new Creature(4, 2, {
    layers: [
      { count: 12 },
      { count: 10 },
      { count: 8 },
      { count: 6 },
    ],
  });

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const effective = computeEffectiveConfig(creature, config);

  assertGreater(
    effective.learningRate,
    config.learningRate,
    "Learning rate should be scaled up for large networks",
  );
});

// -----------------------------------------------------------------------
// Test: Boundary case — exactly 10 hidden neurons
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: exactly 10 hidden neurons returns config as-is", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 10 }],
  });

  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertEquals(hiddenCount, 10, "Should have exactly 10 hidden neurons");

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const effective = computeEffectiveConfig(creature, config);

  assertAlmostEquals(effective.inferenceRate, config.inferenceRate, 1e-15);
  assertAlmostEquals(effective.energyThreshold, config.energyThreshold, 1e-15);
  assertAlmostEquals(effective.learningRate, config.learningRate, 1e-15);
});

// -----------------------------------------------------------------------
// Test: Scaling is proportional to network size
// -----------------------------------------------------------------------

Deno.test("Adaptive scaling: larger networks get more scaling", () => {
  const mediumCreature = new Creature(4, 2, {
    layers: [{ count: 20 }],
  });

  const largeCreature = new Creature(4, 2, {
    layers: [
      { count: 20 },
      { count: 15 },
      { count: 10 },
      { count: 8 },
    ],
  });

  const config = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };
  const mediumEffective = computeEffectiveConfig(mediumCreature, config);
  const largeEffective = computeEffectiveConfig(largeCreature, config);

  // Larger network should have lower inference rate.
  assertLess(
    largeEffective.inferenceRate,
    mediumEffective.inferenceRate,
    "Larger network should have lower inference rate",
  );

  // Larger network should have higher energy threshold.
  assertGreater(
    largeEffective.energyThreshold,
    mediumEffective.energyThreshold,
    "Larger network should have higher energy threshold",
  );

  // Larger network should have higher learning rate.
  assertGreater(
    largeEffective.learningRate,
    mediumEffective.learningRate,
    "Larger network should have higher learning rate",
  );
});

// -----------------------------------------------------------------------
// Helper: builds a complex creature for training tests
// -----------------------------------------------------------------------

function makeComplexCreature(): Creature {
  const squashFunctions = [
    "TANH",
    "LOGISTIC",
    "ReLU",
    "IDENTITY",
    "SELU",
    "Swish",
  ];

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerSizes = [12, 10, 8, 6];
  const inputCount = 4;
  const outputCount = 2;
  const layerUUIDs: string[][] = [];
  const inputUUIDs = Array.from({ length: inputCount }, (_, i) => `input-${i}`);

  let neuronIdx = 0;
  for (let layer = 0; layer < layerSizes.length; layer++) {
    const layerNodes: string[] = [];
    for (let n = 0; n < layerSizes[layer]; n++) {
      const uuid = `hidden-L${layer}-N${n}`;
      const squash = squashFunctions[neuronIdx % squashFunctions.length];
      const bias = (neuronIdx % 5 - 2) * 0.1;
      neurons.push({ type: "hidden", uuid, squash, bias });
      layerNodes.push(uuid);
      neuronIdx++;
    }
    layerUUIDs.push(layerNodes);
  }

  for (let o = 0; o < outputCount; o++) {
    neurons.push({
      type: "output",
      uuid: `output-${o}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Input → Layer 0
  for (const fromUUID of inputUUIDs) {
    for (const toUUID of layerUUIDs[0]) {
      synapses.push({
        fromUUID,
        toUUID,
        weight: Math.sin(synapses.length * 1.7) * 0.3,
      });
    }
  }

  // Layer[i] → Layer[i+1]
  for (let layer = 0; layer < layerSizes.length - 1; layer++) {
    for (const fromUUID of layerUUIDs[layer]) {
      for (const toUUID of layerUUIDs[layer + 1]) {
        synapses.push({
          fromUUID,
          toUUID,
          weight: Math.sin(synapses.length * 2.3) * 0.2,
        });
      }
    }
  }

  // Last hidden layer → Output
  for (const fromUUID of layerUUIDs[layerSizes.length - 1]) {
    for (const toUUID of [`output-0`, `output-1`]) {
      synapses.push({
        fromUUID,
        toUUID,
        weight: Math.sin(synapses.length * 1.3) * 0.25,
      });
    }
  }

  return Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  });
}

function makeRegressionDataset(
  sampleCount: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const x0 = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    const x1 = Math.cos(t * Math.PI * 2) * 0.5 + 0.5;
    const x2 = t;
    const x3 = 1 - t;
    const y0 = (x0 * x1 + x2 * 0.3) * 0.8;
    const y1 = (x1 * x3 + x0 * 0.2) * 0.6;
    data.push({
      input: new Float32Array([x0, x1, x2, x3]),
      output: new Float32Array([y0, y1]),
    });
  }
  return data;
}

// -----------------------------------------------------------------------
// Test: Default config with adaptive scaling reduces error on complex creature
// -----------------------------------------------------------------------

Deno.test("PC training with default config + adaptive scaling reduces error on 36-neuron creature", () => {
  const creature = makeComplexCreature();

  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(
    hiddenCount,
    30,
    `Expected 30+ hidden neurons, got ${hiddenCount}`,
  );

  const dataSet = makeRegressionDataset(12);
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    // Use DEFAULT config — no manual tuning.
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
    };

    // Baseline: zero learning rate = no weight updates.
    const baselineCreature = Creature.fromJSON(creature.exportJSON());
    const baseline = trainWithPredictiveCoding(
      baselineCreature,
      [dataSetDir + "/0.bin"],
      { ...pcConfig, learningRate: 0 },
      Costs.find("MSE"),
      { iterations: 1, targetError: 0 },
    );

    // Train with default PC config (adaptive scaling applied internally).
    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 30, targetError: 0.001 },
    );

    assert(Number.isFinite(baseline.error), "Baseline error should be finite");
    assert(Number.isFinite(result.error), "Trained error should be finite");
    assert(result.changed, "Training should have changed weights");

    // Error should decrease after training with default config.
    assertLess(
      result.error,
      baseline.error,
      "Default PC config with adaptive scaling should reduce error on complex creature",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});
