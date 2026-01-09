import { assertEquals } from "@std/assert";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { evaluateDirMaybeWGPU } from "../../src/wgpu/EvaluateDirWGPU.ts";

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

Deno.test({
  name:
    "WGSL evaluation produces identical error to CPU (exact match safe squashes)",
  ignore: !isGPUEnvEnabled(),
  async fn() {
    if (!hasWebGPU()) {
      throw new Error(
        "NEAT_WGPU_ACTIVATION=1 but WebGPU is not available. " +
          "Run tests with: deno test --unstable-webgpu ...",
      );
    }

    // Keep this creature strictly in the "exact match safe" squash set.
    const creature = new Creature(2, 1, {
      layers: [{ count: 2, squash: "ReLU" }],
    });

    // Make weights/biases deterministic and exactly representable in f32.
    // (Integers and simple fractions are intentional here.)
    for (const synapse of creature.synapses) {
      synapse.weight = synapse.weight >= 0 ? 1 : -1;
    }
    for (let i = creature.input; i < creature.neurons.length; i++) {
      const neuron = creature.neurons[i];
      if (neuron.type !== "constant") neuron.bias = 0;
      neuron.squash = "ReLU";
    }
    creature.fix();

    const cost = Costs.find("MSE");

    // Create a tiny deterministic dataset where targets equal the creature output.
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-wgpu-eq-" });
    const filePath = `${tmpDir}/0.bin`;

    const inputs: Float32Array[] = [
      new Float32Array([0, 0]),
      new Float32Array([1, 2]),
      new Float32Array([-1, 3]),
      new Float32Array([2, -2]),
    ];

    const valuesCount = creature.input + creature.output;
    const records = new Float32Array(inputs.length * valuesCount);

    for (let r = 0; r < inputs.length; r++) {
      creature.clearState();
      const out = creature.activate(inputs[r], false);

      const base = r * valuesCount;
      records[base + 0] = inputs[r][0];
      records[base + 1] = inputs[r][1];
      records[base + 2] = out[0];
    }

    await Deno.writeFile(filePath, new Uint8Array(records.buffer));

    // CPU baseline.
    const cpu = creature.evaluateDir(tmpDir, cost, false);
    assertEquals(cpu.error, 0);

    // GPU path (should be exact-zero too).
    const gpu = await evaluateDirMaybeWGPU(creature, tmpDir, cost, false);
    assertEquals(gpu.error, 0);
    assertEquals(gpu.error, cpu.error);
  },
});
