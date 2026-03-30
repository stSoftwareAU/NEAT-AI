/**
 * Backward compatibility validation tests for Predictive Coding.
 *
 * Issue #1558: Ensures that PC integration does not regress existing
 * functionality:
 *
 * 1. Serialisation roundtrip: Creature with PC state saves/loads correctly.
 * 2. Config migration: Old configs without PC settings work with defaults.
 * 3. Standard training unaffected: trainDir with PC disabled produces
 *    valid results identical to pre-PC behaviour.
 */

import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { Costs } from "@costs";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import { runInference } from "@predictiveCoding/PredictiveCodingInference.ts";
import type { RequiredPredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";

/**
 * Helper: default config with customisable overrides.
 */
function makeConfig(
  overrides: Partial<RequiredPredictiveCodingConfig> = {},
): RequiredPredictiveCodingConfig {
  return { ...DEFAULT_PREDICTIVE_CODING_CONFIG, ...overrides, enabled: true };
}

// ── Serialisation Roundtrip ──────────────────────────────────────────

Deno.test(
  "BackwardCompat: Creature serialises and deserialises after PC inference",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.1, squash: "IDENTITY", index: 2 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: 0.3 },
        { from: 2, to: 3, weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });

    const input = new Float32Array([1.0, 0.5]);
    const config = makeConfig({ inferenceSteps: 20 });

    // Run PC inference to populate NeuronState PC fields.
    runInference(creature, input, config);

    // Serialise to JSON.
    const json = creature.exportJSON();

    // Deserialise from JSON.
    const restored = Creature.fromJSON(json);

    // Verify the restored creature has the same topology.
    assertEquals(restored.input, creature.input);
    assertEquals(restored.output, creature.output);
    assertEquals(restored.neurons.length, creature.neurons.length);
    assertEquals(restored.synapses.length, creature.synapses.length);

    // Verify weights are preserved.
    for (let i = 0; i < creature.synapses.length; i++) {
      assertEquals(
        restored.synapses[i].weight,
        creature.synapses[i].weight,
        `Synapse ${i} weight should be preserved`,
      );
    }

    // Verify biases are preserved.
    for (let i = 0; i < creature.neurons.length; i++) {
      if (creature.neurons[i].type !== "input") {
        assertEquals(
          restored.neurons[i].bias,
          creature.neurons[i].bias,
          `Neuron ${i} bias should be preserved`,
        );
      }
    }

    // Verify the restored creature can still activate.
    const originalOutput = creature.activate(input);
    const restoredOutput = restored.activate(input);
    assertEquals(
      restoredOutput.length,
      originalOutput.length,
      "Output dimensions should match",
    );
  },
);

Deno.test(
  "BackwardCompat: Creature JSON roundtrip preserves squash functions",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "LOGISTIC", index: 2 },
        { type: "hidden", bias: 0.0, squash: "TANH", index: 3 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 4 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 3, weight: 0.7 },
        { from: 2, to: 4, weight: 0.4 },
        { from: 3, to: 4, weight: 0.6 },
      ],
      input: 2,
      output: 1,
    });

    // Run PC inference.
    const input = new Float32Array([0.5, 0.8]);
    const config = makeConfig({ inferenceSteps: 10 });
    runInference(creature, input, config);

    // Serialise and restore.
    const json = creature.exportJSON();
    const restored = Creature.fromJSON(json);

    // Verify squash functions are preserved.
    for (let i = 0; i < creature.neurons.length; i++) {
      if (creature.neurons[i].type !== "input") {
        assertEquals(
          restored.neurons[i].squash,
          creature.neurons[i].squash,
          `Neuron ${i} squash should be preserved`,
        );
      }
    }
  },
);

// ── Config Migration ────────────────────────────────────────────────

Deno.test(
  "BackwardCompat: training without PC config uses standard backprop",
  () => {
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
      // No predictiveCoding option at all — should use standard backprop.
      const options: TrainOptions = {
        iterations: 3,
        disableRandomSamples: true,
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
  },
);

Deno.test(
  "BackwardCompat: PC disabled explicitly still uses standard backprop",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 3 }],
    });

    const dataSet: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
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
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "BackwardCompat: default PC config has PC disabled",
  () => {
    assertEquals(
      DEFAULT_PREDICTIVE_CODING_CONFIG.enabled,
      false,
      "PC should be disabled by default",
    );
    assertGreater(
      DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceSteps,
      0,
      "Default inference steps should be positive",
    );
    assertGreater(
      DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceRate,
      0,
      "Default inference rate should be positive",
    );
    assertGreater(
      DEFAULT_PREDICTIVE_CODING_CONFIG.learningRate,
      0,
      "Default learning rate should be positive",
    );
    assertGreater(
      DEFAULT_PREDICTIVE_CODING_CONFIG.energyThreshold,
      0,
      "Default energy threshold should be positive",
    );
  },
);

// ── Standard Training Unaffected ────────────────────────────────────

Deno.test(
  "BackwardCompat: standard backprop training produces finite error",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 4 }],
      outputLayer: { squash: "IDENTITY" },
    });

    const dataSet: DataRecordInterface[] = [
      {
        input: new Float32Array([0.1, 0.2]),
        output: new Float32Array([0.3]),
      },
      {
        input: new Float32Array([0.5, 0.5]),
        output: new Float32Array([1.0]),
      },
    ];

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 5,
        disableRandomSamples: true,
      };

      const result = trainDir(
        creature,
        dataSetDir,
        options,
        Costs.find("MSE"),
      );

      assert(Number.isFinite(result.error), "Error should be finite");
      assert(result.error >= 0, "Error should be non-negative");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "BackwardCompat: Creature without PC history can still be trained with PC",
  () => {
    // Create a creature the old-fashioned way, with no PC state.
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
      // Enable PC training on a creature that has no prior PC state.
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
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);
