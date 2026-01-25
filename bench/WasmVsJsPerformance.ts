/**
 * WASM vs JS Performance Benchmark
 *
 * Issue #1161 - Confirm WASM provides performance benefit for large creatures
 *
 * This benchmark demonstrates that WASM activation is faster than JavaScript
 * for large creatures with large training datasets. This justifies making
 * WASM the default with no fallback to JS.
 *
 * Run with:
 *   deno bench --allow-read bench/WasmVsJsPerformance.ts
 *
 * The benchmark tests:
 * 1. Small creatures (minimal overhead)
 * 2. Medium creatures (typical use case)
 * 3. Large creatures (expected WASM advantage)
 * 4. Very large creatures (significant WASM advantage)
 * 5. Batch processing (WASM optimised path)
 * 6. activateAndTrace for backpropagation
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  getCompiledCreatureStats,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../src/wasm/mod.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";

// Supported squash functions for WASM
const SUPPORTED_SQUASHES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "SELU",
  "ELU",
  "LeakyReLU",
  "Softplus",
  "Swish",
  "Mish",
  "GELU",
  "IDENTITY",
  "HARD_TANH",
  "SOFTSIGN",
  "GAUSSIAN",
  "BENT_IDENTITY",
  "BIPOLAR_SIGMOID",
  "SINE",
  "Cosine",
  "ArcTan",
  "ABSOLUTE",
  "SQUARE",
  "Cube",
];

/**
 * Create a synthetic creature with specified complexity
 */
function createBenchmarkCreature(
  numInputs: number,
  numHiddenLayers: number,
  neuronsPerLayer: number,
  numOutputs: number,
  seed: number = 42,
): Creature {
  // Simple seeded random for reproducibility
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  let currentIndex = numInputs;

  // Create hidden layers
  for (let layer = 0; layer < numHiddenLayers; layer++) {
    for (let n = 0; n < neuronsPerLayer; n++) {
      const squash = SUPPORTED_SQUASHES[
        Math.floor(random() * SUPPORTED_SQUASHES.length)
      ];
      neurons.push({
        type: "hidden",
        index: currentIndex,
        bias: random() * 2 - 1,
        squash,
      });
      currentIndex++;
    }
  }

  // Create output neurons
  for (let o = 0; o < numOutputs; o++) {
    neurons.push({
      type: "output",
      index: currentIndex,
      bias: random() * 0.5 - 0.25,
      squash: "LOGISTIC",
    });
    currentIndex++;
  }

  // Connect inputs to first hidden layer
  const firstLayerStart = numInputs;
  const firstLayerEnd = numInputs + neuronsPerLayer;
  for (let i = 0; i < numInputs; i++) {
    for (let h = firstLayerStart; h < firstLayerEnd; h++) {
      if (random() > 0.3) {
        // 70% connection probability
        synapses.push({
          from: i,
          to: h,
          weight: random() * 2 - 1,
        });
      }
    }
  }

  // Connect hidden layers
  for (let layer = 0; layer < numHiddenLayers - 1; layer++) {
    const layerStart = numInputs + layer * neuronsPerLayer;
    const layerEnd = layerStart + neuronsPerLayer;
    const nextLayerStart = layerEnd;
    const nextLayerEnd = nextLayerStart + neuronsPerLayer;

    for (let from = layerStart; from < layerEnd; from++) {
      for (let to = nextLayerStart; to < nextLayerEnd; to++) {
        if (random() > 0.5) {
          // 50% connection probability
          synapses.push({
            from,
            to,
            weight: random() * 2 - 1,
          });
        }
      }
    }
  }

  // Connect last hidden layer to outputs
  const lastLayerStart = numInputs + (numHiddenLayers - 1) * neuronsPerLayer;
  const lastLayerEnd = lastLayerStart + neuronsPerLayer;
  const outputStart = numInputs + numHiddenLayers * neuronsPerLayer;

  for (let h = lastLayerStart; h < lastLayerEnd; h++) {
    for (let o = 0; o < numOutputs; o++) {
      if (random() > 0.2) {
        // 80% connection probability
        synapses.push({
          from: h,
          to: outputStart + o,
          weight: random() * 2 - 1,
        });
      }
    }
  }

  const creatureJson: CreatureInternal = {
    neurons,
    synapses,
    input: numInputs,
    output: numOutputs,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.fix();
  creature.clearState();
  return creature;
}

/**
 * Generate random inputs for benchmarking
 */
function generateInputs(inputSize: number, count: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = new Float32Array(inputSize);
    for (let j = 0; j < inputSize; j++) {
      data[j] = Math.random() * 2 - 1;
    }
    inputs.push(data);
  }
  return inputs;
}

// Get project root for WASM path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM
const wasmInitialised = await initWasmActivation(wasmPath);
if (!wasmInitialised) {
  console.error(
    "Failed to initialise WASM module. Ensure wasm_activation is built.",
  );
  console.error("Run: cd wasm_activation && ./build.sh");
  Deno.exit(1);
}

console.log(`\n${"=".repeat(70)}`);
console.log("WASM vs JS Performance Benchmark");
console.log(`${"=".repeat(70)}`);
console.log(`WASM available: ${isWasmActivationAvailable()}`);
console.log();

// =============================================================================
// Benchmark Configuration
// =============================================================================

interface BenchmarkConfig {
  name: string;
  inputs: number;
  hiddenLayers: number;
  neuronsPerLayer: number;
  outputs: number;
  iterations: number;
}

const benchmarkConfigs: BenchmarkConfig[] = [
  // Small creature - minimal overhead test
  {
    name: "Small (10 neurons)",
    inputs: 5,
    hiddenLayers: 1,
    neuronsPerLayer: 5,
    outputs: 2,
    iterations: 5000,
  },
  // Medium creature - typical use case
  {
    name: "Medium (50 neurons)",
    inputs: 10,
    hiddenLayers: 2,
    neuronsPerLayer: 20,
    outputs: 5,
    iterations: 2000,
  },
  // Large creature - expected WASM advantage
  {
    name: "Large (200 neurons)",
    inputs: 20,
    hiddenLayers: 3,
    neuronsPerLayer: 60,
    outputs: 10,
    iterations: 1000,
  },
  // Very large creature - significant WASM advantage
  {
    name: "Very Large (500 neurons)",
    inputs: 50,
    hiddenLayers: 4,
    neuronsPerLayer: 110,
    outputs: 20,
    iterations: 500,
  },
];

// =============================================================================
// Create benchmark creatures and inputs
// =============================================================================

const benchmarkData: Map<
  string,
  {
    creature: Creature;
    wasmActivation: WasmCreatureActivation;
    inputs: Float32Array[];
    config: BenchmarkConfig;
  }
> = new Map();

for (const config of benchmarkConfigs) {
  const creature = createBenchmarkCreature(
    config.inputs,
    config.hiddenLayers,
    config.neuronsPerLayer,
    config.outputs,
  );

  const compiled = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiled);

  if (!wasmActivation) {
    console.error(`Failed to create WASM activation for ${config.name}`);
    Deno.exit(1);
  }

  const inputs = generateInputs(config.inputs, 100);

  console.log(`${config.name}:`);
  console.log(`  Total neurons: ${creature.neurons.length}`);
  console.log(`  Synapses: ${creature.synapses.length}`);
  console.log(`  ${getCompiledCreatureStats(compiled)}`);
  console.log();

  benchmarkData.set(config.name, {
    creature,
    wasmActivation,
    inputs,
    config,
  });
}

console.log(`${"=".repeat(70)}`);
console.log("Running benchmarks...\n");

// =============================================================================
// Benchmark 1: Small Creature
// =============================================================================

{
  const { creature, wasmActivation, inputs, config } =
    benchmarkData.get("Small (10 neurons)")!;

  Deno.bench(`Small: JS Activation (${config.iterations} iterations)`, {
    group: "small",
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      creature.activate(inputs[i % inputs.length], false, true);
    }
  });

  Deno.bench(`Small: WASM Activation (${config.iterations} iterations)`, {
    group: "small",
    baseline: true,
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      wasmActivation.activate(inputs[i % inputs.length]);
    }
  });
}

// =============================================================================
// Benchmark 2: Medium Creature
// =============================================================================

{
  const { creature, wasmActivation, inputs, config } =
    benchmarkData.get("Medium (50 neurons)")!;

  Deno.bench(`Medium: JS Activation (${config.iterations} iterations)`, {
    group: "medium",
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      creature.activate(inputs[i % inputs.length], false, true);
    }
  });

  Deno.bench(`Medium: WASM Activation (${config.iterations} iterations)`, {
    group: "medium",
    baseline: true,
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      wasmActivation.activate(inputs[i % inputs.length]);
    }
  });
}

// =============================================================================
// Benchmark 3: Large Creature
// =============================================================================

{
  const { creature, wasmActivation, inputs, config } =
    benchmarkData.get("Large (200 neurons)")!;

  Deno.bench(`Large: JS Activation (${config.iterations} iterations)`, {
    group: "large",
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      creature.activate(inputs[i % inputs.length], false, true);
    }
  });

  Deno.bench(`Large: WASM Activation (${config.iterations} iterations)`, {
    group: "large",
    baseline: true,
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      wasmActivation.activate(inputs[i % inputs.length]);
    }
  });
}

// =============================================================================
// Benchmark 4: Very Large Creature
// =============================================================================

{
  const { creature, wasmActivation, inputs, config } =
    benchmarkData.get("Very Large (500 neurons)")!;

  Deno.bench(`Very Large: JS Activation (${config.iterations} iterations)`, {
    group: "very-large",
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      creature.activate(inputs[i % inputs.length], false, true);
    }
  });

  Deno.bench(`Very Large: WASM Activation (${config.iterations} iterations)`, {
    group: "very-large",
    baseline: true,
  }, () => {
    for (let i = 0; i < config.iterations; i++) {
      wasmActivation.activate(inputs[i % inputs.length]);
    }
  });
}

// =============================================================================
// Benchmark 5: activateAndTrace (for backpropagation)
// =============================================================================

{
  const { creature, config } = benchmarkData.get("Large (200 neurons)")!;
  const inputs = generateInputs(config.inputs, 100);
  const iterations = 200; // Fewer iterations as this is more expensive

  // Create creatures for JS and WASM testing
  const jsCreature = Creature.fromJSON(creature.exportJSON());
  jsCreature.validate();
  const wasmCreature = Creature.fromJSON(creature.exportJSON());
  wasmCreature.validate();

  const bpConfig = createBackPropagationConfig({ sparseRatio: 1 });

  Deno.bench(`ActivateAndTrace: JS (${iterations} iterations)`, {
    group: "trace",
  }, () => {
    const sparseConfig = new SparseConfig(jsCreature.exportJSON(), bpConfig);
    for (let i = 0; i < iterations; i++) {
      jsCreature.activateAndTrace(
        inputs[i % inputs.length],
        false,
        sparseConfig,
        true, // useJs = true
      );
    }
  });

  Deno.bench(`ActivateAndTrace: WASM (${iterations} iterations)`, {
    group: "trace",
    baseline: true,
  }, () => {
    const sparseConfig = new SparseConfig(wasmCreature.exportJSON(), bpConfig);
    for (let i = 0; i < iterations; i++) {
      wasmCreature.activateAndTrace(
        inputs[i % inputs.length],
        false,
        sparseConfig,
        false, // useJs = false (WASM)
      );
    }
  });
}

// =============================================================================
// Benchmark 6: Large Training Dataset Simulation
// =============================================================================

{
  const { creature, config } = benchmarkData.get("Large (200 neurons)")!;

  // Simulate a training scenario with 1000 samples
  const trainingInputs = generateInputs(config.inputs, 1000);
  const trainingTargets: Float32Array[] = [];
  for (let i = 0; i < 1000; i++) {
    const target = new Float32Array(config.outputs);
    for (let j = 0; j < config.outputs; j++) {
      target[j] = Math.random();
    }
    trainingTargets.push(target);
  }

  const bpConfig = createBackPropagationConfig({
    sparseRatio: 1,
    trainingMutationRate: 0.3,
  });

  // JS training epoch
  Deno.bench("Training Epoch: JS (1000 samples)", { group: "training" }, () => {
    const jsCreature = Creature.fromJSON(creature.exportJSON());
    jsCreature.validate();
    const sparseConfig = new SparseConfig(jsCreature.exportJSON(), bpConfig);

    for (let i = 0; i < 100; i++) {
      // 100 samples per bench iteration
      jsCreature.activateAndTrace(
        trainingInputs[i],
        false,
        sparseConfig,
        true, // useJs = true
      );
      jsCreature.propagate(trainingTargets[i], bpConfig, sparseConfig);
    }
  });

  // WASM training epoch
  Deno.bench(
    "Training Epoch: WASM (1000 samples)",
    { group: "training", baseline: true },
    () => {
      const wasmCreature = Creature.fromJSON(creature.exportJSON());
      wasmCreature.validate();
      const sparseConfig = new SparseConfig(
        wasmCreature.exportJSON(),
        bpConfig,
      );

      for (let i = 0; i < 100; i++) {
        // 100 samples per bench iteration
        wasmCreature.activateAndTrace(
          trainingInputs[i],
          false,
          sparseConfig,
          false, // useJs = false (WASM)
        );
        wasmCreature.propagate(trainingTargets[i], bpConfig, sparseConfig);
      }
    },
  );
}

// =============================================================================
// Benchmark 7: Creature via activate() API (using internal WASM selection)
// =============================================================================

{
  const { creature, inputs, config } = benchmarkData.get(
    "Large (200 neurons)",
  )!;

  // Test the default activate() path which should use WASM
  Deno.bench(
    `Default API: creature.activate() (${config.iterations} iterations)`,
    { group: "api" },
    () => {
      for (let i = 0; i < config.iterations; i++) {
        creature.activate(inputs[i % inputs.length], false, false);
      }
    },
  );

  // Compare with explicit JS path
  Deno.bench(
    `Explicit JS: creature.activate(useJs=true) (${config.iterations} iterations)`,
    { group: "api" },
    () => {
      for (let i = 0; i < config.iterations; i++) {
        creature.activate(inputs[i % inputs.length], false, true);
      }
    },
  );
}
