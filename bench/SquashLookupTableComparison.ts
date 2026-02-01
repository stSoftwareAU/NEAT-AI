/**
 * WASM activation benchmark (Issue #1238: JS dynamic activation code removed).
 *
 * Benchmarks creature.activate() which uses WASM exclusively.
 *
 * Run with: deno bench --allow-read bench/SquashLookupTableComparison.ts
 */
import { Creature } from "../src/Creature.ts";

// Create test creature with many squash functions
const creature = Creature.fromJSON({
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

creature.validate();

const inputs: Float32Array[] = [];
for (let i = 0; i < 1000; i++) {
  inputs.push(new Float32Array([Math.random() * 2 - 1, Math.random() * 2 - 1]));
}

Deno.bench("WASM activation (mixed squashes)", () => {
  for (let i = 0; i < 10000; i++) {
    creature.activate(inputs[i % inputs.length], false);
  }
});
