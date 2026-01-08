import { Creature } from "../src/Creature.ts";
import { WGPUActivation } from "../src/wgpu/WGPUActivation.ts";

/**
 * Benchmark comparing CPU vs WGPU activation performance.
 *
 * Run with: deno bench --allow-all --unstable-webgpu bench/WGPUActivate.ts
 *
 * Note: GPU excels at batched operations. Single activations will likely be
 * slower due to data transfer overhead. The benefit comes from processing
 * many inputs in parallel.
 */

// Create a moderately complex creature for benchmarking
function createBenchCreature(): Creature {
  const creature = new Creature(100, 10, {
    layers: [
      { count: 200, squash: "ReLU" },
      { count: 100, squash: "TANH" },
      { count: 50, squash: "LOGISTIC" },
    ],
  });

  // Randomize weights for realistic performance
  for (const synapse of creature.synapses) {
    synapse.weight = (Math.random() - 0.5) * 2;
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      neuron.bias = (Math.random() - 0.5) * 2;
    }
  }

  creature.fix();
  return creature;
}

// Generate random inputs
function generateInputs(inputSize: number, count: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const input = new Float32Array(inputSize);
    for (let j = 0; j < inputSize; j++) {
      input[j] = (Math.random() - 0.5) * 4;
    }
    inputs.push(input);
  }
  return inputs;
}

// Generate batched inputs
function generateBatchedInputs(
  inputSize: number,
  batchSize: number,
): Float32Array {
  const batch = new Float32Array(inputSize * batchSize);
  for (let i = 0; i < batch.length; i++) {
    batch[i] = (Math.random() - 0.5) * 4;
  }
  return batch;
}

// Check for WebGPU support
const hasGPU = typeof navigator !== "undefined" && !!navigator.gpu;

if (!hasGPU) {
  console.log("WebGPU not available. Run with --unstable-webgpu flag.");
  console.log("Skipping GPU benchmarks.");
}

const creature = createBenchCreature();
const inputs = generateInputs(creature.input, 1000);

console.log(
  `Creature: ${creature.input} inputs, ${creature.output} outputs, ${creature.neurons.length} neurons`,
);

// Pre-generate batched inputs
const batch100 = generateBatchedInputs(creature.input, 100);
const batch500 = generateBatchedInputs(creature.input, 500);
const batch1000 = generateBatchedInputs(creature.input, 1000);
const batch2000 = generateBatchedInputs(creature.input, 2000);

// CPU Benchmark: 1000 sequential activations
Deno.bench({
  name: "CPU: 1000 sequential activations",
  group: "sequential",
  baseline: true,
  fn() {
    for (let i = 0; i < 1000; i++) {
      creature.activate(inputs[i % inputs.length], false);
    }
  },
});

// GPU benchmarks only if WebGPU is available
if (hasGPU) {
  // Initialize GPU outside benchmark to exclude setup time
  let wgpu: WGPUActivation | null = null;

  // Setup hook to initialize WGPU
  const setupGPU = async () => {
    if (!wgpu) {
      wgpu = await WGPUActivation.create(creature);
    }
    return wgpu;
  };

  // Batch size 100
  Deno.bench({
    name: "GPU: 100 batched activations",
    group: "batch-100",
    async fn() {
      const gpu = await setupGPU();
      await gpu.activateBatch(batch100);
    },
  });

  Deno.bench({
    name: "CPU: 100 sequential activations",
    group: "batch-100",
    baseline: true,
    fn() {
      for (let i = 0; i < 100; i++) {
        creature.activate(inputs[i % inputs.length], false);
      }
    },
  });

  // Batch size 500
  Deno.bench({
    name: "GPU: 500 batched activations",
    group: "batch-500",
    async fn() {
      const gpu = await setupGPU();
      await gpu.activateBatch(batch500);
    },
  });

  Deno.bench({
    name: "CPU: 500 sequential activations",
    group: "batch-500",
    baseline: true,
    fn() {
      for (let i = 0; i < 500; i++) {
        creature.activate(inputs[i % inputs.length], false);
      }
    },
  });

  // Batch size 1000
  Deno.bench({
    name: "GPU: 1000 batched activations",
    group: "batch-1000",
    async fn() {
      const gpu = await setupGPU();
      await gpu.activateBatch(batch1000);
    },
  });

  Deno.bench({
    name: "CPU: 1000 sequential activations",
    group: "batch-1000",
    baseline: true,
    fn() {
      for (let i = 0; i < 1000; i++) {
        creature.activate(inputs[i % inputs.length], false);
      }
    },
  });

  // Batch size 2000
  Deno.bench({
    name: "GPU: 2000 batched activations",
    group: "batch-2000",
    async fn() {
      const gpu = await setupGPU();
      await gpu.activateBatch(batch2000);
    },
  });

  Deno.bench({
    name: "CPU: 2000 sequential activations",
    group: "batch-2000",
    baseline: true,
    fn() {
      for (let i = 0; i < 2000; i++) {
        creature.activate(inputs[i % inputs.length], false);
      }
    },
  });

  // Throughput comparison
  Deno.bench({
    name: "GPU: 2000 batch (throughput test)",
    group: "throughput",
    async fn() {
      const gpu = await setupGPU();
      await gpu.activateBatch(batch2000);
    },
  });

  Deno.bench({
    name: "CPU: 2000 sequential (throughput test)",
    group: "throughput",
    baseline: true,
    fn() {
      for (let i = 0; i < 2000; i++) {
        creature.activate(inputs[i % inputs.length], false);
      }
    },
  });
}
