/**
 * Detailed benchmark for squash lookup table optimisation (Issue #1017).
 *
 * This benchmark measures the performance impact of the lookup table approach
 * vs the original individual parameter approach.
 *
 * Run with: deno bench --allow-read bench/SquashLookupTableDetailed.ts
 */
import { Creature } from "../src/Creature.ts";

// Load the traced.json test creature (has mixed squash functions)
const tracedCreature = Creature.fromJSON(
  JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
);
tracedCreature.fix();
tracedCreature.clearState();

// Generate inputs
function generateInputs(count: number, inputSize: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const input = new Float32Array(inputSize);
    for (let j = 0; j < inputSize; j++) {
      input[j] = Math.random() * 4 - 2;
    }
    inputs.push(input);
  }
  return inputs;
}

const inputs = generateInputs(1000, tracedCreature.input);

// Warm up
for (let i = 0; i < 100; i++) {
  tracedCreature.activate(inputs[i % inputs.length]);
}

/**
 * Benchmark activation with the traced.json creature.
 * This creature has many different squash functions including non-inline ones.
 */
Deno.bench("Activate traced.json (1000 iterations)", () => {
  for (let i = 0; i < 1000; i++) {
    tracedCreature.activate(inputs[i % inputs.length]);
  }
});

/**
 * Single activation call for micro-benchmark.
 */
Deno.bench("Activate traced.json (single)", () => {
  tracedCreature.activate(inputs[0]);
});

/**
 * Create creature with only non-inline squash functions to test lookup table.
 */
const nonInlineCreature = Creature.fromJSON({
  neurons: [
    { bias: 0.1, type: "hidden", squash: "SELU", index: 2 },
    { bias: 0.2, type: "hidden", squash: "ELU", index: 3 },
    { bias: -0.1, type: "hidden", squash: "GELU", index: 4 },
    { bias: 0.3, type: "hidden", squash: "Swish", index: 5 },
    { bias: -0.2, type: "hidden", squash: "Mish", index: 6 },
    { bias: 0.05, type: "hidden", squash: "LOGISTIC", index: 7 },
    { bias: 0.15, type: "hidden", squash: "LeakyReLU", index: 8 },
    { bias: 0.25, type: "hidden", squash: "Softplus", index: 9 },
    { bias: -0.05, type: "hidden", squash: "BENT_IDENTITY", index: 10 },
    { bias: 0.0, type: "hidden", squash: "SOFTSIGN", index: 11 },
    { bias: 0.1, type: "hidden", squash: "GAUSSIAN", index: 12 },
    { bias: 0.0, type: "output", squash: "IDENTITY", index: 13 },
  ],
  synapses: [
    { weight: 1.0, from: 0, to: 2 },
    { weight: 0.5, from: 0, to: 3 },
    { weight: -0.5, from: 0, to: 4 },
    { weight: 0.3, from: 0, to: 5 },
    { weight: -0.3, from: 0, to: 6 },
    { weight: 0.8, from: 1, to: 7 },
    { weight: -0.8, from: 1, to: 8 },
    { weight: 0.6, from: 1, to: 9 },
    { weight: -0.6, from: 1, to: 10 },
    { weight: 0.4, from: 1, to: 11 },
    { weight: -0.4, from: 1, to: 12 },
    { weight: 0.1, from: 2, to: 13 },
    { weight: 0.1, from: 3, to: 13 },
    { weight: 0.1, from: 4, to: 13 },
    { weight: 0.1, from: 5, to: 13 },
    { weight: 0.1, from: 6, to: 13 },
    { weight: 0.1, from: 7, to: 13 },
    { weight: 0.1, from: 8, to: 13 },
    { weight: 0.1, from: 9, to: 13 },
    { weight: 0.1, from: 10, to: 13 },
    { weight: 0.1, from: 11, to: 13 },
    { weight: 0.1, from: 12, to: 13 },
  ],
  input: 2,
  output: 1,
});

nonInlineCreature.validate();
const smallInputs = generateInputs(1000, 2);

// Warm up
for (let i = 0; i < 100; i++) {
  nonInlineCreature.activate(smallInputs[i % smallInputs.length]);
}

Deno.bench("Activate 11 non-inline squash neurons (10000 iterations)", () => {
  for (let i = 0; i < 10000; i++) {
    nonInlineCreature.activate(smallInputs[i % smallInputs.length]);
  }
});

/**
 * Create creature with only inline squash functions for comparison.
 */
const inlineCreature = Creature.fromJSON({
  neurons: [
    { bias: 0.1, type: "hidden", squash: "TANH", index: 2 },
    { bias: 0.2, type: "hidden", squash: "IDENTITY", index: 3 },
    { bias: -0.1, type: "hidden", squash: "ReLU", index: 4 },
    { bias: 0.3, type: "hidden", squash: "ABSOLUTE", index: 5 },
    { bias: -0.2, type: "hidden", squash: "SINE", index: 6 },
    { bias: 0.05, type: "hidden", squash: "TANH", index: 7 },
    { bias: 0.15, type: "hidden", squash: "IDENTITY", index: 8 },
    { bias: 0.25, type: "hidden", squash: "ReLU", index: 9 },
    { bias: -0.05, type: "hidden", squash: "ABSOLUTE", index: 10 },
    { bias: 0.0, type: "hidden", squash: "SINE", index: 11 },
    { bias: 0.1, type: "hidden", squash: "TANH", index: 12 },
    { bias: 0.0, type: "output", squash: "IDENTITY", index: 13 },
  ],
  synapses: [
    { weight: 1.0, from: 0, to: 2 },
    { weight: 0.5, from: 0, to: 3 },
    { weight: -0.5, from: 0, to: 4 },
    { weight: 0.3, from: 0, to: 5 },
    { weight: -0.3, from: 0, to: 6 },
    { weight: 0.8, from: 1, to: 7 },
    { weight: -0.8, from: 1, to: 8 },
    { weight: 0.6, from: 1, to: 9 },
    { weight: -0.6, from: 1, to: 10 },
    { weight: 0.4, from: 1, to: 11 },
    { weight: -0.4, from: 1, to: 12 },
    { weight: 0.1, from: 2, to: 13 },
    { weight: 0.1, from: 3, to: 13 },
    { weight: 0.1, from: 4, to: 13 },
    { weight: 0.1, from: 5, to: 13 },
    { weight: 0.1, from: 6, to: 13 },
    { weight: 0.1, from: 7, to: 13 },
    { weight: 0.1, from: 8, to: 13 },
    { weight: 0.1, from: 9, to: 13 },
    { weight: 0.1, from: 10, to: 13 },
    { weight: 0.1, from: 11, to: 13 },
    { weight: 0.1, from: 12, to: 13 },
  ],
  input: 2,
  output: 1,
});

inlineCreature.validate();

// Warm up
for (let i = 0; i < 100; i++) {
  inlineCreature.activate(smallInputs[i % smallInputs.length]);
}

Deno.bench("Activate 11 inline squash neurons (10000 iterations)", () => {
  for (let i = 0; i < 10000; i++) {
    inlineCreature.activate(smallInputs[i % smallInputs.length]);
  }
});
