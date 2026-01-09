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
      // Keep the network moderately sized. The current WebGPU path generates a
      // fully-unrolled WGSL shader which grows with synapse count; very dense
      // networks can exceed driver limits and produce invalid (NaN) outputs.
      { count: 64, squash: "ReLU" },
      { count: 32, squash: "TANH" },
    ],
    // Important: output squashes are random by default, and many squashes do not
    // have WGSL implementations. That can lead to incorrect GPU outputs (and
    // even NaN/Infinity) which makes the benchmark meaningless.
    //
    // Keep outputs in a WGSL-supported, bounded range.
    outputLayer: { squash: "LOGISTIC" },
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

function cpuActivateBatched(
  c: Creature,
  batchedInputs: Float32Array,
  batchSize: number,
): number {
  const inSize = c.input;
  const outSize = c.output;
  const scratchInput = new Float32Array(inSize);
  let sum = 0;

  for (let i = 0; i < batchSize; i++) {
    const start = i * inSize;
    for (let j = 0; j < inSize; j++) {
      scratchInput[j] = batchedInputs[start + j];
    }
    const out = c.activate(scratchInput, false);
    for (let o = 0; o < outSize; o++) {
      sum += out[o];
    }
  }

  return sum;
}

// CPU Benchmark: 1000 sequential activations
Deno.bench({
  name: "CPU: 1000 sequential activations",
  group: "sequential",
  baseline: true,
  fn() {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const out = creature.activate(inputs[i % inputs.length], false);
      sum += out[0] ?? 0;
    }
    // Prevent dead-code elimination.
    if (!Number.isFinite(sum)) {
      throw new Error("Non-finite sum");
    }
  },
});

// GPU benchmarks only if WebGPU is available
if (hasGPU) {
  // Initialize GPU outside benchmark to exclude setup time
  let wgpu: WGPUActivation | null = null;

  // Pre-flight correctness check. This ensures we're not benchmarking a broken
  // GPU path (eg NaNs due to overflow behaviour differences).
  {
    wgpu = await WGPUActivation.create(creature);
    const gpuOut = await wgpu.activateBatch(batch100);

    let maxAbsDiff = 0;
    for (let i = 0; i < 100; i++) {
      const start = i * creature.input;
      const cpuInput = batch100.subarray(start, start + creature.input);
      creature.clearState();
      const cpuOut = creature.activate(new Float32Array(cpuInput), false);
      for (let o = 0; o < creature.output; o++) {
        const gv = gpuOut[i * creature.output + o];
        const cv = cpuOut[o];
        const diff = Math.abs(gv - cv);
        if (diff > maxAbsDiff) maxAbsDiff = diff;
      }
    }

    console.log(`Pre-flight max |GPU-CPU| on batch100: ${maxAbsDiff}`);
    if (!Number.isFinite(maxAbsDiff) || maxAbsDiff > 1e-1) {
      throw new Error(
        `GPU outputs diverged from CPU too much (maxAbsDiff=${maxAbsDiff}).`,
      );
    }
  }

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
      const out = await gpu.activateBatch(batch100);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      if (!Number.isFinite(sum)) {
        throw new Error("Non-finite sum");
      }
    },
  });

  Deno.bench({
    name: "CPU: 100 sequential activations (batched input)",
    group: "batch-100",
    baseline: true,
    fn() {
      const sum = cpuActivateBatched(creature, batch100, 100);
      if (!Number.isFinite(sum)) throw new Error("Non-finite sum");
    },
  });

  // Batch size 500
  Deno.bench({
    name: "GPU: 500 batched activations",
    group: "batch-500",
    async fn() {
      const gpu = await setupGPU();
      const out = await gpu.activateBatch(batch500);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      if (!Number.isFinite(sum)) {
        throw new Error("Non-finite sum");
      }
    },
  });

  Deno.bench({
    name: "CPU: 500 sequential activations (batched input)",
    group: "batch-500",
    baseline: true,
    fn() {
      const sum = cpuActivateBatched(creature, batch500, 500);
      if (!Number.isFinite(sum)) throw new Error("Non-finite sum");
    },
  });

  // Batch size 1000
  Deno.bench({
    name: "GPU: 1000 batched activations",
    group: "batch-1000",
    async fn() {
      const gpu = await setupGPU();
      const out = await gpu.activateBatch(batch1000);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      if (!Number.isFinite(sum)) {
        throw new Error("Non-finite sum");
      }
    },
  });

  Deno.bench({
    name: "CPU: 1000 sequential activations (batched input)",
    group: "batch-1000",
    baseline: true,
    fn() {
      const sum = cpuActivateBatched(creature, batch1000, 1000);
      if (!Number.isFinite(sum)) throw new Error("Non-finite sum");
    },
  });

  // Batch size 2000
  Deno.bench({
    name: "GPU: 2000 batched activations",
    group: "batch-2000",
    async fn() {
      const gpu = await setupGPU();
      const out = await gpu.activateBatch(batch2000);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      if (!Number.isFinite(sum)) {
        throw new Error("Non-finite sum");
      }
    },
  });

  Deno.bench({
    name: "CPU: 2000 sequential activations (batched input)",
    group: "batch-2000",
    baseline: true,
    fn() {
      const sum = cpuActivateBatched(creature, batch2000, 2000);
      if (!Number.isFinite(sum)) throw new Error("Non-finite sum");
    },
  });

  // Throughput comparison
  Deno.bench({
    name: "GPU: 2000 batch (throughput test)",
    group: "throughput",
    async fn() {
      const gpu = await setupGPU();
      const out = await gpu.activateBatch(batch2000);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      if (!Number.isFinite(sum)) {
        throw new Error("Non-finite sum");
      }
    },
  });

  Deno.bench({
    name: "CPU: 2000 sequential (throughput test, batched input)",
    group: "throughput",
    baseline: true,
    fn() {
      const sum = cpuActivateBatched(creature, batch2000, 2000);
      if (!Number.isFinite(sum)) throw new Error("Non-finite sum");
    },
  });
}
