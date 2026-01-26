/**
 * Issue #1214 - Batch Weight and Bias Gradient Accumulation Performance Benchmark
 *
 * This benchmark measures the performance improvement from batch gradient accumulation
 * compared to single-synapse/neuron processing during backpropagation.
 *
 * The batch functions are designed to reduce function call overhead when processing
 * multiple synapses/neurons. They are particularly useful when the caller already has
 * data organised in arrays (e.g., from WASM buffers or TypedArrays).
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/BatchGradientAccumulation.ts
 */

import { NeuronState } from "../src/architecture/CreatureState.ts";
import {
  createBackPropagationConfig,
} from "../src/propagate/BackPropagation.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
} from "../src/propagate/Bias.ts";
import { SynapseState } from "../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
} from "../src/propagate/Weight.ts";

console.log("\n" + "=".repeat(70));
console.log("Issue #1214: Batch Gradient Accumulation Performance Benchmark");
console.log("=".repeat(70));

// Configuration for backpropagation
const config = createBackPropagationConfig({
  generations: 10,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
});

// Seeded random number generator for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1; // Range: -1 to 1
  };
}

// Generate test data
const BATCH_SIZE = 64;
const NUM_BATCHES = 100; // Total iterations = 6400
const random = seededRandom(42);

// Pre-generate all test data for weight accumulation as regular arrays
const weightTestData = {
  currentWeights: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random(),
  ),
  targetValues: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random(),
  ),
  activations: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random() * 0.5 + 0.1,
  ), // Mostly non-zero
};

// Pre-generate all test data for bias accumulation as regular arrays
const biasTestData = {
  currentBiases: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random() * 0.5,
  ),
  targetPreActivationValues: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random(),
  ),
  preActivationValues: Array.from(
    { length: BATCH_SIZE * NUM_BATCHES },
    () => random(),
  ),
};

// Pre-allocate reusable arrays for batch calls to reduce allocation overhead
const reusableArrays = {
  weight4: {
    currentWeights: new Array<number>(4),
    targetValues: new Array<number>(4),
    activations: new Array<number>(4),
  },
  weight8: {
    currentWeights: new Array<number>(8),
    targetValues: new Array<number>(8),
    activations: new Array<number>(8),
  },
  bias4: {
    currentBiases: new Array<number>(4),
    targetPreActivationValues: new Array<number>(4),
    preActivationValues: new Array<number>(4),
  },
  bias8: {
    currentBiases: new Array<number>(8),
    targetPreActivationValues: new Array<number>(8),
    preActivationValues: new Array<number>(8),
  },
};

// ============================================================================
// WEIGHT ACCUMULATION BENCHMARKS
// ============================================================================

Deno.bench({
  name: "Weight: Single calls (baseline)",
  group: "weight-accumulation",
  baseline: true,
}, () => {
  const states: SynapseState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new SynapseState());
  }

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let i = 0; i < BATCH_SIZE; i++) {
      accumulateWeight(
        weightTestData.currentWeights[offset + i],
        states[i],
        weightTestData.targetValues[offset + i],
        weightTestData.activations[offset + i],
        config,
      );
    }
  }
});

Deno.bench({
  name: "Weight: 4-way batch (reusable arrays)",
  group: "weight-accumulation",
}, () => {
  const states: SynapseState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new SynapseState());
  }

  const arr = reusableArrays.weight4;
  const batches4 = BATCH_SIZE / 4;

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let b = 0; b < batches4; b++) {
      const idx = b * 4;

      // Fill reusable arrays
      for (let k = 0; k < 4; k++) {
        arr.currentWeights[k] = weightTestData.currentWeights[offset + idx + k];
        arr.targetValues[k] = weightTestData.targetValues[offset + idx + k];
        arr.activations[k] = weightTestData.activations[offset + idx + k];
      }

      accumulateWeightBatch4Way(
        arr.currentWeights,
        [states[idx], states[idx + 1], states[idx + 2], states[idx + 3]],
        arr.targetValues,
        arr.activations,
        config,
      );
    }
  }
});

Deno.bench({
  name: "Weight: 8-way batch (reusable arrays)",
  group: "weight-accumulation",
}, () => {
  const states: SynapseState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new SynapseState());
  }

  const arr = reusableArrays.weight8;
  const batches8 = BATCH_SIZE / 8;

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let b = 0; b < batches8; b++) {
      const idx = b * 8;

      // Fill reusable arrays
      for (let k = 0; k < 8; k++) {
        arr.currentWeights[k] = weightTestData.currentWeights[offset + idx + k];
        arr.targetValues[k] = weightTestData.targetValues[offset + idx + k];
        arr.activations[k] = weightTestData.activations[offset + idx + k];
      }

      accumulateWeightBatch8Way(
        arr.currentWeights,
        [
          states[idx],
          states[idx + 1],
          states[idx + 2],
          states[idx + 3],
          states[idx + 4],
          states[idx + 5],
          states[idx + 6],
          states[idx + 7],
        ],
        arr.targetValues,
        arr.activations,
        config,
      );
    }
  }
});

// ============================================================================
// BIAS ACCUMULATION BENCHMARKS
// ============================================================================

Deno.bench({
  name: "Bias: Single calls (baseline)",
  group: "bias-accumulation",
  baseline: true,
}, () => {
  const states: NeuronState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new NeuronState());
  }

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let i = 0; i < BATCH_SIZE; i++) {
      accumulateBias(
        states[i],
        biasTestData.targetPreActivationValues[offset + i],
        biasTestData.preActivationValues[offset + i],
        biasTestData.currentBiases[offset + i],
        config,
      );
    }
  }
});

Deno.bench({
  name: "Bias: 4-way batch (reusable arrays)",
  group: "bias-accumulation",
}, () => {
  const states: NeuronState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new NeuronState());
  }

  const arr = reusableArrays.bias4;
  const batches4 = BATCH_SIZE / 4;

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let b = 0; b < batches4; b++) {
      const idx = b * 4;

      // Fill reusable arrays
      for (let k = 0; k < 4; k++) {
        arr.currentBiases[k] = biasTestData.currentBiases[offset + idx + k];
        arr.targetPreActivationValues[k] =
          biasTestData.targetPreActivationValues[offset + idx + k];
        arr.preActivationValues[k] =
          biasTestData.preActivationValues[offset + idx + k];
      }

      accumulateBiasBatch4Way(
        [states[idx], states[idx + 1], states[idx + 2], states[idx + 3]],
        arr.targetPreActivationValues,
        arr.preActivationValues,
        arr.currentBiases,
        config,
      );
    }
  }
});

Deno.bench({
  name: "Bias: 8-way batch (reusable arrays)",
  group: "bias-accumulation",
}, () => {
  const states: NeuronState[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    states.push(new NeuronState());
  }

  const arr = reusableArrays.bias8;
  const batches8 = BATCH_SIZE / 8;

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    for (let b = 0; b < batches8; b++) {
      const idx = b * 8;

      // Fill reusable arrays
      for (let k = 0; k < 8; k++) {
        arr.currentBiases[k] = biasTestData.currentBiases[offset + idx + k];
        arr.targetPreActivationValues[k] =
          biasTestData.targetPreActivationValues[offset + idx + k];
        arr.preActivationValues[k] =
          biasTestData.preActivationValues[offset + idx + k];
      }

      accumulateBiasBatch8Way(
        [
          states[idx],
          states[idx + 1],
          states[idx + 2],
          states[idx + 3],
          states[idx + 4],
          states[idx + 5],
          states[idx + 6],
          states[idx + 7],
        ],
        arr.targetPreActivationValues,
        arr.preActivationValues,
        arr.currentBiases,
        config,
      );
    }
  }
});

console.log("\n" + "=".repeat(70));
console.log("Benchmarks queued. Running...\n");
console.log("Note: The batch functions provide API building blocks for future");
console.log(
  "WASM integration and TypedArray-based batch processing scenarios.",
);
console.log("=".repeat(70) + "\n");
