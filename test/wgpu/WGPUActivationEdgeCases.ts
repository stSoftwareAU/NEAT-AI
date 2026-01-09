import { assertEquals, assertRejects } from "@std/assert";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { WGPUActivation } from "../../src/wgpu/WGPUActivation.ts";

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

function isGPUEnvEnabled(): boolean {
  try {
    return Deno.env.get("NEAT_WGPU_ACTIVATION") === "1";
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "WGPUActivation.evaluateChunked returns 0 for empty inputs (no NaN, no crash)",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "ReLU" }],
    });
    creature.fix();

    const wgpu = await WGPUActivation.create(creature);
    try {
      const cost = Costs.find("MSE");
      const error = await wgpu.evaluateChunked(
        new Float32Array(),
        new Float32Array(),
        cost,
      );
      assertEquals(error, 0);
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name: "WGPUActivation.activateBatch returns empty outputs for empty inputs",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "ReLU" }],
    });
    creature.fix();

    const wgpu = await WGPUActivation.create(creature);
    try {
      const outputs = await wgpu.activateBatch(new Float32Array());
      assertEquals(outputs.length, 0);
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name: "WGPUActivation.evaluateBatch returns 0 for empty inputs/targets",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "ReLU" }],
    });
    creature.fix();

    const wgpu = await WGPUActivation.create(creature);
    try {
      const cost = Costs.find("MSE");
      const error = await wgpu.evaluateBatch(
        new Float32Array(),
        new Float32Array(),
        cost,
      );
      assertEquals(error, 0);
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name:
    "WGPUActivation.evaluateChunked throws for inputs shorter than inputCount (prevents silent NaN)",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "ReLU" }],
    });
    creature.fix();

    const wgpu = await WGPUActivation.create(creature);
    try {
      const cost = Costs.find("MSE");
      await assertRejects(
        () =>
          wgpu.evaluateChunked(
            new Float32Array([1, 2]), // inputCount=3
            new Float32Array(),
            cost,
          ),
        Error,
        "smaller than input count",
      );
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name:
    "WGPUActivation.evaluateChunked throws for non-divisible input length and mismatched targets",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "ReLU" }],
    });
    creature.fix();

    const wgpu = await WGPUActivation.create(creature);
    try {
      const cost = Costs.find("MSE");
      await assertRejects(
        () =>
          wgpu.evaluateChunked(
            new Float32Array([1, 2, 3, 4]), // 4 % 3 !== 0
            new Float32Array(),
            cost,
          ),
        Error,
        "not divisible",
      );

      await assertRejects(
        () =>
          wgpu.evaluateChunked(
            new Float32Array([1, 2, 3]), // 1 sample
            new Float32Array([0]), // outputCount=2, expected targets=2
            cost,
          ),
        Error,
        "Targets length",
      );
    } finally {
      wgpu.dispose();
    }
  },
});
