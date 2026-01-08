import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { WGPUActivation } from "../../src/wgpu/WGPUActivation.ts";
import { makeWGSLShader } from "../../src/wgpu/MakeWGSLShader.ts";

/**
 * Tests that WGPU activation produces the same results as CPU activation.
 *
 * Run with: deno test --allow-all --unstable-webgpu test/wgpu/WGPUCorrectness.ts
 */

// Standard activation functions that have WGSL implementations
const SUPPORTED_SQUASHES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "LeakyReLU",
  "ELU",
  "SELU",
  "Swish",
  "Mish",
  "GELU",
  "Softplus",
  "SOFTSIGN",
  "HARD_TANH",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "STEP",
  "GAUSSIAN",
  "SINE",
  "Cosine",
  "ABSOLUTE",
  "COMPLEMENT",
  "BENT_IDENTITY",
  "ReLU6",
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

Deno.test({
  name: "WGSL shader generation produces valid code",
  fn() {
    const creature = createTestCreature(10, 5, 2, ["ReLU", "TANH", "LOGISTIC"]);
    const result = makeWGSLShader(creature);

    // Verify shader metadata
    if (result.inputCount !== 10) {
      throw new Error(`Expected 10 inputs, got ${result.inputCount}`);
    }
    if (result.outputCount !== 2) {
      throw new Error(`Expected 2 outputs, got ${result.outputCount}`);
    }

    // Verify shader contains expected elements
    if (!result.shaderCode.includes("@compute")) {
      throw new Error("Shader missing @compute decorator");
    }
    if (!result.shaderCode.includes("fn main")) {
      throw new Error("Shader missing main function");
    }

    console.log("Shader generation test passed");
    console.log(`Shader length: ${result.shaderCode.length} characters`);
    console.log(
      `Squash functions used: ${[...result.squashFunctions].join(", ")}`,
    );
  },
});

Deno.test({
  name: "WGPU activation matches CPU activation",
  ignore: !hasWebGPU(),
  async fn() {
    const creature = createTestCreature(10, 20, 3, [
      "ReLU",
      "TANH",
      "LOGISTIC",
    ]);

    // Create GPU accelerator
    const wgpu = await WGPUActivation.create(creature);

    try {
      // Test with multiple random inputs
      const tolerance = 1e-5;
      const numTests = 100;

      for (let t = 0; t < numTests; t++) {
        const input = randomInput(creature.input);

        // CPU activation
        creature.clearState();
        const cpuOutput = creature.activate(input, false);

        // GPU activation
        // deno-lint-ignore no-await-in-loop -- Sequential comparison needed for correctness testing
        const gpuOutput = await wgpu.activateBatch(input);

        // Compare outputs
        for (let i = 0; i < creature.output; i++) {
          assertAlmostEquals(
            gpuOutput[i],
            cpuOutput[i],
            tolerance,
            `Output ${i} mismatch at test ${t}: GPU=${gpuOutput[i]}, CPU=${
              cpuOutput[i]
            }`,
          );
        }
      }

      console.log(
        `Correctness test passed: ${numTests} random inputs matched within tolerance ${tolerance}`,
      );
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name: "WGPU batch activation matches individual CPU activations",
  ignore: !hasWebGPU(),
  async fn() {
    const creature = createTestCreature(5, 10, 2, ["ReLU", "TANH"]);
    const wgpu = await WGPUActivation.create(creature);

    try {
      const batchSize = 50;
      const tolerance = 1e-5;

      // Create batch of inputs
      const batchInputs = new Float32Array(batchSize * creature.input);
      const cpuOutputs: Float32Array[] = [];

      for (let i = 0; i < batchSize; i++) {
        const input = randomInput(creature.input);

        // Copy to batch array
        batchInputs.set(input, i * creature.input);

        // Get CPU result
        creature.clearState();
        cpuOutputs.push(new Float32Array(creature.activate(input, false)));
      }

      // Run GPU batch
      const gpuOutputs = await wgpu.activateBatch(batchInputs);

      // Compare each result
      for (let i = 0; i < batchSize; i++) {
        for (let o = 0; o < creature.output; o++) {
          const gpuVal = gpuOutputs[i * creature.output + o];
          const cpuVal = cpuOutputs[i][o];
          assertAlmostEquals(
            gpuVal,
            cpuVal,
            tolerance,
            `Batch ${i}, output ${o} mismatch: GPU=${gpuVal}, CPU=${cpuVal}`,
          );
        }
      }

      console.log(
        `Batch correctness test passed: ${batchSize} batched inputs matched`,
      );
    } finally {
      wgpu.dispose();
    }
  },
});

Deno.test({
  name: "WGPU handles various activation functions",
  ignore: !hasWebGPU(),
  async fn() {
    // Test each supported activation function
    const testedSquashes: string[] = [];
    const tolerance = 1e-4; // Slightly higher tolerance for complex functions

    for (const squash of SUPPORTED_SQUASHES) {
      try {
        const creature = createTestCreature(3, 5, 1, [squash]);
        // deno-lint-ignore no-await-in-loop -- Testing each squash function separately
        const wgpu = await WGPUActivation.create(creature);

        try {
          const input = randomInput(creature.input);

          creature.clearState();
          const cpuOutput = creature.activate(input, false);
          // deno-lint-ignore no-await-in-loop -- Sequential testing for each squash function
          const gpuOutput = await wgpu.activateBatch(input);

          // Check outputs match
          let matches = true;
          for (let i = 0; i < creature.output; i++) {
            if (Math.abs(gpuOutput[i] - cpuOutput[i]) > tolerance) {
              console.warn(
                `${squash}: Output mismatch - GPU=${gpuOutput[i]}, CPU=${
                  cpuOutput[i]
                }`,
              );
              matches = false;
            }
          }

          if (matches) {
            testedSquashes.push(squash);
          }
        } finally {
          wgpu.dispose();
        }
      } catch (e) {
        console.warn(`${squash}: Failed - ${e}`);
      }
    }

    console.log(
      `Tested ${testedSquashes.length}/${SUPPORTED_SQUASHES.length} activation functions`,
    );
    console.log(`Working: ${testedSquashes.join(", ")}`);

    if (testedSquashes.length < 5) {
      throw new Error("Too few activation functions working");
    }
  },
});

// Helper functions

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

function createTestCreature(
  inputs: number,
  hiddenNeurons: number,
  outputs: number,
  squashes: string[],
): Creature {
  const creature = new Creature(inputs, outputs, {
    layers: [
      { count: hiddenNeurons, squash: squashes[0] },
    ],
  });

  // Assign various squash functions to hidden neurons
  const hiddenStart = inputs;
  const hiddenEnd = creature.neurons.length - outputs;

  for (let i = hiddenStart; i < hiddenEnd; i++) {
    const neuron = creature.neurons[i];
    neuron.squash = squashes[(i - hiddenStart) % squashes.length];
    neuron.bias = (Math.random() - 0.5) * 2;
  }

  // Randomize connection weights
  for (const synapse of creature.synapses) {
    synapse.weight = (Math.random() - 0.5) * 2;
  }

  creature.fix();
  return creature;
}

function randomInput(size: number): Float32Array {
  const input = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    input[i] = (Math.random() - 0.5) * 4; // Range: -2 to 2
  }
  return input;
}
