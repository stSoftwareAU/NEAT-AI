/**
 * Regression: WASM vs JS score parity.
 *
 * This test intentionally does NOT use external GRQ files/datasets.
 * It builds a deterministic synthetic creature + dataset and asserts that
 * end-to-end scoring (avg error + score calculation) matches between:
 * - WASM-default activation (Creature.activate(...))
 * - forced-JS activation (Creature.activate(..., useJs=true))
 *
 * NOTE (2026-01): WASM activation now prioritizes throughput and uses an f32-first
 * implementation. Exact parity with JS (f64) is not guaranteed, especially for
 * numerically sensitive squashes (e.g. TAN/Cosine).
 *
 * This regression now checks *rough* parity on a deterministic synthetic dataset
 * using stable squashes (Logistic/Tanh), and only asserts finiteness.
 */

import { assert, assertAlmostEquals } from "@std/assert";
import { Costs, Creature } from "../../mod.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { calculate as calculateScore } from "../../src/architecture/Score.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../../src/wasm/mod.ts";

// Get the project root directory for WASM module path
// (this file lives under `test/score/`, so we need to go up twice)
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

Deno.test({
  name: "WASM score parity: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test("WASM scoring: synthetic dataset is finite and roughly matches JS", () => {
  const rand = seededRandom(123456);

  const inputSize = 64;
  const hiddenA = 16;
  const hiddenB = 16;
  const outputIndex = inputSize + hiddenA + hiddenB;

  // Build a creature with periodic + sensitive squashes in the path.
  const neurons: CreatureInternal["neurons"] = [];

  // Hidden A (mix of SQUARE/Cube)
  for (let i = 0; i < hiddenA; i++) {
    neurons.push({
      type: "hidden",
      index: inputSize + i,
      bias: (rand() * 2 - 1) * 5,
      squash: i % 2 === 0 ? "SQUARE" : "Cube",
    });
  }

  // Hidden B (stable squashes; avoid periodic sensitivity in f32)
  for (let i = 0; i < hiddenB; i++) {
    neurons.push({
      type: "hidden",
      index: inputSize + hiddenA + i,
      bias: (rand() * 2 - 1) * 5,
      squash: i % 2 === 0 ? "LOGISTIC" : "TANH",
    });
  }

  // Output (IDENTITY)
  neurons.push({
    type: "output",
    index: outputIndex,
    bias: (rand() * 2 - 1),
    squash: "IDENTITY",
  });

  const synapses: CreatureInternal["synapses"] = [];

  // Inputs -> Hidden A
  for (let h = 0; h < hiddenA; h++) {
    const to = inputSize + h;
    for (let i = 0; i < inputSize; i++) {
      // Weights sized to produce values that can stress periodic functions downstream
      const w = (rand() * 2 - 1) * 3;
      synapses.push({ from: i, to, weight: w });
    }
  }

  // Hidden A -> Hidden B
  for (let b = 0; b < hiddenB; b++) {
    const to = inputSize + hiddenA + b;
    for (let h = 0; h < hiddenA; h++) {
      const from = inputSize + h;
      const w = (rand() * 2 - 1) * 2;
      synapses.push({ from, to, weight: w });
    }
  }

  // Hidden B -> Output
  for (let b = 0; b < hiddenB; b++) {
    const from = inputSize + hiddenA + b;
    const w = (rand() * 2 - 1) * 2;
    synapses.push({ from, to: outputIndex, weight: w });
  }

  const creatureJson: CreatureInternal = {
    neurons,
    synapses,
    input: inputSize,
    output: 1,
  };

  const base = Creature.fromJSON(creatureJson);
  base.fix();

  const wasmCreature = base.shallowClone();
  wasmCreature.clearState();
  const jsCreature = base.shallowClone();
  jsCreature.clearState();

  const cost = Costs.find("MSE");
  const costOfGrowth = 0.000_000_1;

  // Deterministic synthetic records
  const RECORDS = 256;
  let wasmErr = 0;
  let jsErr = 0;

  for (let rIdx = 0; rIdx < RECORDS; rIdx++) {
    const input = new Float32Array(inputSize);
    for (let i = 0; i < inputSize; i++) {
      input[i] = (rand() * 2 - 1) * 3;
    }

    // Deterministic target: simple bounded function of inputs
    const target = new Float32Array([input[0] * 0.2 + input[1] * -0.1]);

    const wasmOut = wasmCreature.activate(input, false);
    const jsOut = jsCreature.activate(input, false, true);

    wasmErr += cost.calculate(target, wasmOut);
    jsErr += cost.calculate(target, jsOut);
  }

  const wasmAvg = wasmErr / RECORDS;
  const jsAvg = jsErr / RECORDS;

  const wasmScore = calculateScore(wasmCreature, wasmAvg, costOfGrowth);
  const jsScore = calculateScore(jsCreature, jsAvg, costOfGrowth);

  assert(Number.isFinite(wasmAvg), "WASM average error should be finite");
  assert(Number.isFinite(jsAvg), "JS average error should be finite");
  assert(Number.isFinite(wasmScore), "WASM score should be finite");
  assert(Number.isFinite(jsScore), "JS score should be finite");

  // Rough parity check (f32 vs f64): allow small absolute drift.
  assertAlmostEquals(wasmAvg, jsAvg, 1e-3, "averageError drift too large");
  assertAlmostEquals(wasmScore, jsScore, 1e-3, "score drift too large");
});
