/**
 * End-to-end backpropagation convergence test for every standard squash function.
 *
 * For each squash type, we build a minimal creature (input -> hidden -> output),
 * train it with backpropagation, and verify that the output moves closer to the
 * target. This "proves" that the full backprop pipeline (calculateError,
 * safeZoneAdjustment, elastic distribution, weight/bias updates) works correctly
 * for every squash function.
 *
 * Closes #1389
 */
import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

/**
 * All standard (non-aggregate, non-deprecated) squash function names.
 * Aggregate functions (IF, MAXIMUM, MINIMUM) require multiple inputs per neuron
 * and are tested separately elsewhere.
 */
const STANDARD_SQUASH_NAMES = [
  "ABSOLUTE",
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "COMPLEMENT",
  "Cosine",
  "Cube",
  "ELU",
  "Exponential",
  "GAUSSIAN",
  "GELU",
  "HARD_TANH",
  "IDENTITY",
  "ISRU",
  "LeakyReLU",
  "LOGISTIC",
  "LogSigmoid",
  "Mish",
  "ReLU",
  "ReLU6",
  "SELU",
  "SINE",
  "SOFTSIGN",
  "Softplus",
  "SQRT",
  "SQUARE",
  "STEP",
  "StdInverse",
  "Swish",
  "TAN",
  "TANH",
];

/**
 * Builds a simple creature: 1 input -> 1 hidden (with given squash) -> 1 output (IDENTITY).
 * Output uses IDENTITY so we can isolate the hidden neuron's squash behaviour.
 */
function makeCreature(squashName: string): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: squashName, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/**
 * Run backpropagation training and check that the output converges toward
 * the target. We allow multiple attempts because the stochastic elements
 * of elastic distribution and sparse selection can cause occasional
 * non-convergence on the first try.
 */
function testConvergence(squashName: string) {
  const inputValue = 0.5;
  const targetOutput = 0.3;
  const input = new Float32Array([inputValue]);
  const target = new Float32Array([targetOutput]);

  for (let attempt = 0; attempt < 50; attempt++) {
    const creature = makeCreature(squashName);

    const initialOutput = creature.activate(input);
    const initialError = Math.abs(initialOutput[0] - targetOutput);

    // If the network already produces the target, that's fine
    if (initialError < 0.01) {
      return;
    }

    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 1,
      disableRandomSamples: true,
      batchSize: 1,
    });

    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    // Train for several iterations
    for (let i = 0; i < 200; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }

    creature.propagateUpdate(config, sparseConfig);
    creature.clearState();

    const finalOutput = creature.activate(input);
    const finalError = Math.abs(finalOutput[0] - targetOutput);

    // Success if error decreased or became very small
    if (finalError < initialError || finalError < 0.1) {
      assert(
        Number.isFinite(finalOutput[0]),
        `${squashName}: output must be finite, got ${finalOutput[0]}`,
      );
      return;
    }
  }

  // If we get here after all attempts, that's a failure
  assert(
    false,
    `${squashName}: backpropagation did not converge after 50 attempts`,
  );
}

// Generate a test for each standard squash function
for (const squashName of STANDARD_SQUASH_NAMES) {
  Deno.test(`Backprop convergence: ${squashName}`, () => {
    testConvergence(squashName);
  });
}
