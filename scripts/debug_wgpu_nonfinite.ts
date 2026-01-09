import { Creature } from "../src/Creature.ts";
import { WGPUActivation } from "../src/wgpu/WGPUActivation.ts";
import { makeWGSLShader } from "../src/wgpu/MakeWGSLShader.ts";

/**
 * Debug helper for investigating non-finite outputs (NaN/Infinity) from WebGPU
 * activation.
 *
 * Run with:
 * `deno run --allow-read --unstable-webgpu scripts/debug_wgpu_nonfinite.ts`
 */

function createBenchCreature(): Creature {
  const creature = new Creature(100, 10, {
    layers: [
      { count: 64, squash: "ReLU" },
      { count: 32, squash: "TANH" },
    ],
    outputLayer: { squash: "LOGISTIC" },
  });

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

function firstNonFiniteIndex(values: Float32Array): number | null {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return i;
  }
  return null;
}

function countNonFinite(values: Float32Array): { nan: number; inf: number } {
  let nan = 0;
  let inf = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) nan++;
    else if (!Number.isFinite(v)) inf++;
  }
  return { nan, inf };
}

if (typeof navigator === "undefined" || !navigator.gpu) {
  console.log("WebGPU not available. Run with --unstable-webgpu flag.");
  Deno.exit(0);
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  console.log("WebGPU adapter not available on this machine.");
  Deno.exit(0);
}

const creature = createBenchCreature();
const shaderPreview = makeWGSLShader(creature);
console.log({
  shaderLengthChars: shaderPreview.shaderCode.length,
  workgroupSize: shaderPreview.workgroupSize,
  squashFunctions: [...shaderPreview.squashFunctions].slice(0, 10),
});
const batchSize = 100;
const inputs = generateBatchedInputs(creature.input, batchSize);

const wgpu = await WGPUActivation.create(creature);
try {
  const gpuOutputs = await wgpu.activateBatch(inputs);
  const first = firstNonFiniteIndex(gpuOutputs);
  const counts = countNonFinite(gpuOutputs);
  console.log({
    batchSize,
    inputCount: creature.input,
    outputCount: creature.output,
    outputLength: gpuOutputs.length,
    nonFinite: counts,
    firstNonFiniteIndex: first,
    firstNonFiniteValue: first === null ? null : gpuOutputs[first],
  });

  if (first !== null) {
    const sample = Math.floor(first / creature.output);
    const outputIdx = first % creature.output;
    const inStart = sample * creature.input;
    const inEnd = inStart + creature.input;
    const input = inputs.subarray(inStart, inEnd);
    creature.clearState();
    const cpuOutput = creature.activate(new Float32Array(input), false);
    console.log({
      sample,
      outputIdx,
      cpuValue: cpuOutput[outputIdx],
    });
  }
} finally {
  wgpu.dispose();
}
