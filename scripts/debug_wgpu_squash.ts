import { Creature } from "../src/Creature.ts";
import { WGPUActivation } from "../src/wgpu/WGPUActivation.ts";

/**
 * Debug helper for checking CPU vs GPU squash outputs for a 1-input/1-output creature.
 *
 * Run with:
 * `NEAT_WGPU_ACTIVATION=1 deno run --allow-read --unstable-webgpu scripts/debug_wgpu_squash.ts Mish 100`
 */

const squash = Deno.args[0] ?? "Mish";
const x = Number(Deno.args[1] ?? "100");

if (typeof navigator === "undefined" || !navigator.gpu) {
  console.log("WebGPU not available.");
  Deno.exit(0);
}

const creature = new Creature(1, 1, { layers: [], outputLayer: { squash } });
for (const synapse of creature.synapses) synapse.weight = 1;
const outNeuron = creature.neurons[1];
outNeuron.bias = 0;
outNeuron.squash = squash;
creature.fix();

creature.clearState();
const cpu = creature.activate(new Float32Array([x]), false)[0];

const wgpu = await WGPUActivation.create(creature);
try {
  const gpu = (await wgpu.activateBatch(new Float32Array([x])))[0];
  console.log({ squash, x, cpu, gpu });
} finally {
  wgpu.dispose();
}
