import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { WGPUActivation } from "../../src/wgpu/WGPUActivation.ts";

function isGPUEnvEnabled(): boolean {
  try {
    return Deno.env.get("NEAT_WGPU_ACTIVATION") === "1";
  } catch {
    return false;
  }
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

async function hasUsableWebGPUAdapter(): Promise<boolean> {
  if (!hasWebGPU()) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

function assertAllFinite(values: Float32Array, label: string): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      throw new Error(`${label}: non-finite at index ${i}: ${String(v)}`);
    }
  }
}

/**
 * This test focuses only on finiteness (no NaN/Infinity), mirroring the CPU
 * path which clamps/guards against non-finite values in activation squashes.
 */
Deno.test({
  name: "WGPU activation outputs are finite for stress inputs",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    if (!(await hasUsableWebGPUAdapter())) return;

    const creature = new Creature(50, 5, {
      layers: [
        { count: 32, squash: "ReLU" },
        { count: 16, squash: "TANH" },
      ],
      outputLayer: { squash: "LOGISTIC" },
    });

    // Stress weights/biases but keep them finite.
    for (const synapse of creature.synapses) {
      synapse.weight = (Math.random() - 0.5) * 20;
    }
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input") {
        neuron.bias = (Math.random() - 0.5) * 20;
      }
    }
    creature.fix();

    const batchSize = 512;
    const inputs = new Float32Array(batchSize * creature.input);
    for (let i = 0; i < inputs.length; i++) {
      // Very wide range to stress exp/tanh.
      inputs[i] = (Math.random() - 0.5) * 1e6;
    }

    const wgpu = await WGPUActivation.create(creature);
    try {
      const outputs = await wgpu.activateBatch(inputs);
      assert(outputs.length === batchSize * creature.output);
      assertAllFinite(outputs, "wgpu.activateBatch");
    } finally {
      wgpu.dispose();
    }
  },
});
