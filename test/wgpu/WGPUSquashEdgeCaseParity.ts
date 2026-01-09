import { assertAlmostEquals } from "@std/assert";
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

function assertClose(
  actual: number,
  expected: number,
  context: string,
): void {
  // Mixed absolute + relative tolerance:
  // - For bounded squashes (|y| <= 1) we want tight absolute parity.
  // - For large-magnitude outputs, float32 vs float64 math will differ slightly;
  //   relative tolerance keeps the test meaningful without demanding bitwise identity.
  const absExpected = Math.abs(expected);
  const absTol = absExpected <= 1 ? 1e-4 : 1e-3;
  const relTol = absExpected <= 1 ? 0 : 1e-6;
  const tol = Math.max(absTol, relTol * Math.max(absExpected, 1));
  assertAlmostEquals(actual, expected, tol, context);
}

function edgeInputsForSquash(squash: string): Float32Array {
  // Trigonometric functions are extremely sensitive to argument reduction for
  // very large |x|. JavaScript uses float64 while WGSL uses float32, so values
  // like 1e6 can legitimately differ even though both are "correct" for their
  // numeric model. For parity, we focus edge cases on the practical domain.
  if (squash === "SINE" || squash === "Cosine" || squash === "TAN") {
    const pi = Math.PI;
    const eps = 1e-4;
    return new Float32Array([
      -10,
      -pi,
      -pi / 2 + eps,
      -1,
      -eps,
      0,
      eps,
      1,
      pi / 2 - eps,
      pi,
      10,
    ]);
  }

  // Default edge cases for monotonic and exp/tanh style functions.
  return new Float32Array([
    -1e6,
    -100,
    -10,
    -1,
    -1e-6,
    0,
    1e-6,
    1,
    10,
    100,
    1e6,
  ]);
}

// Squashes supported by the WGSL generator.
const WGSL_SQUASHES = [
  "ReLU",
  "LeakyReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "STEP",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "HARD_TANH",
  "ABSOLUTE",
  "COMPLEMENT",
  "BENT_IDENTITY",
  "SINE",
  "Cosine",
  "SOFTSIGN",
  "Softplus",
  "GAUSSIAN",
  "ELU",
  "SELU",
  "Swish",
  "Mish",
  "GELU",
  "SQUARE",
  "SQRT",
  "Cube",
  "Exponential",
  "TAN",
  "ArcTan",
  "LogSigmoid",
  "ISRU",
  "StdInverse",
];

function makeSingleOutputCreature(squash: string): Creature {
  const creature = new Creature(1, 1, {
    layers: [],
    outputLayer: { squash },
  });

  // Force deterministic/simple mapping: output raw input is input * 1 + 0.
  for (const synapse of creature.synapses) {
    synapse.weight = 1;
  }
  const outNeuron = creature.neurons[1];
  outNeuron.bias = 0;
  outNeuron.squash = squash;

  creature.fix();
  return creature;
}

Deno.test({
  name: "WGSL squash edge cases match CPU (within tolerance) and stay finite",
  ignore: !isGPUEnvEnabled() || !hasWebGPU(),
  async fn() {
    if (!(await hasUsableWebGPUAdapter())) return;

    for (const squash of WGSL_SQUASHES) {
      const creature = makeSingleOutputCreature(squash);
      // deno-lint-ignore no-await-in-loop -- Sequential device/shader creation keeps memory bounded and errors attributable.
      const wgpu = await WGPUActivation.create(creature);
      try {
        const edgeInputs = edgeInputsForSquash(squash);
        // Batched inputs: N samples for 1-input network.
        // deno-lint-ignore no-await-in-loop -- Sequential activation keeps results attributable per squash.
        const gpu = await wgpu.activateBatch(edgeInputs);

        for (let i = 0; i < edgeInputs.length; i++) {
          const x = edgeInputs[i];
          creature.clearState();
          const cpu = creature.activate(new Float32Array([x]), false)[0];
          const gv = gpu[i];

          if (!Number.isFinite(cpu)) {
            throw new Error(`${squash}: CPU returned non-finite for x=${x}`);
          }
          if (!Number.isFinite(gv)) {
            throw new Error(`${squash}: GPU returned non-finite for x=${x}`);
          }

          // Trig functions are sensitive to argument reduction. For sine/cosine
          // the range is bounded so an absolute tolerance is fine. TAN can be
          // unbounded near asymptotes so we use a mixed tolerance.
          if (squash === "SINE" || squash === "Cosine") {
            assertAlmostEquals(
              gv,
              cpu,
              1e-3,
              `${squash}: mismatch for x=${x} (GPU=${gv}, CPU=${cpu})`,
            );
          } else if (squash === "TAN") {
            const absCpu = Math.abs(cpu);
            const tol = Math.max(1e-2, 1e-3 * Math.max(absCpu, 1));
            assertAlmostEquals(
              gv,
              cpu,
              tol,
              `${squash}: mismatch for x=${x} (GPU=${gv}, CPU=${cpu})`,
            );
          } else {
            assertClose(
              gv,
              cpu,
              `${squash}: mismatch for x=${x} (GPU=${gv}, CPU=${cpu})`,
            );
          }
        }
      } finally {
        wgpu.dispose();
      }
    }
  },
});
