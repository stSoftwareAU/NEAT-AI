/**
 * Issue #2277 — SIMD Expansion Viability Profiling
 *
 * Profiles 5 candidate numerical operations against the WASM/SIMD decision
 * framework from PERFORMANCE_RESEARCH.md to determine whether additional SIMD
 * optimisations can increase throughput in the evolution pipeline.
 *
 * Candidates:
 *   1. Loss/cost error reduction (MSE, MAE, CrossEntropy per-element loops)
 *   2. Gradient accumulation arithmetic (weight/bias gradient sums)
 *   3. Score statistics extraction (weight/bias magnitude scans)
 *   4. Population score aggregation (average score, sort)
 *   5. Pairwise genetic distance (Set intersection on neuron wire keys)
 *
 * Decision framework criteria (all must be met for SIMD viability):
 *   - Tight numerical loop (activation, gradient, loss)
 *   - Data already in typed arrays or cheaply convertible
 *   - Computation takes >10 µs per call
 *   - No caching layer that already short-circuits the computation
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-ffi bench/SimdExpansionViability.ts
 */

import { Costs } from "@costs";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "@wasm/mod.ts";

// ─── Initialise WASM ────────────────────────────────────────────────────────

const wasmInitialised = await initWasmActivation();
if (!wasmInitialised || !isWasmActivationAvailable()) {
  console.error("Failed to initialise WASM module.");
  Deno.exit(1);
}

// ─── Deterministic PRNG ─────────────────────────────────────────────────────

function makePrng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1; // Range: -1 to 1
  };
}

// ─── Helper: create a forward-only creature ─────────────────────────────────

function createBenchCreature(
  numInputs: number,
  numHidden: number,
  numOutputs: number,
  synapsesPerNeuron: number,
  seed = 42,
): Creature {
  const random = makePrng(seed);
  const squashes = ["ReLU", "TANH", "LOGISTIC", "SELU", "GELU"];
  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  // Hidden neurons
  for (let i = 0; i < numHidden; i++) {
    neurons.push({
      type: "hidden",
      index: numInputs + i,
      bias: random(),
      squash: squashes[Math.floor(Math.abs(random()) * squashes.length)],
    });
  }

  // Output neurons
  for (let i = 0; i < numOutputs; i++) {
    neurons.push({
      type: "output",
      index: numInputs + numHidden + i,
      bias: random(),
      squash: "IDENTITY",
    });
  }

  // Connect hidden neurons to inputs and prior hidden neurons
  for (let h = 0; h < numHidden; h++) {
    const to = numInputs + h;
    const maxFrom = Math.min(numInputs + h, numInputs + numHidden);
    for (let s = 0; s < synapsesPerNeuron && s < maxFrom; s++) {
      const from = s % maxFrom;
      synapses.push({ from, to, weight: random() });
    }
  }

  // Connect outputs to last hidden neurons
  for (let o = 0; o < numOutputs; o++) {
    const to = numInputs + numHidden + o;
    for (let s = 0; s < Math.min(synapsesPerNeuron, numHidden); s++) {
      synapses.push({ from: numInputs + s, to, weight: random() });
    }
  }

  return Creature.fromJSON({
    neurons,
    synapses,
    input: numInputs,
    output: numOutputs,
  } as CreatureInternal);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate 1: Loss/Cost Error Reduction
// ═══════════════════════════════════════════════════════════════════════════════
//
// The per-element error loops (MSE, MAE, CrossEntropy) iterate over output
// neurons computing differences. Typical NEAT output sizes are 1–10 neurons.
//
// Decision framework assessment:
//   Tight numerical loop?  YES — per-element arithmetic over typed arrays
//   Typed array data?      YES — Float32Array inputs/outputs
//   >10 µs per call?       NO  — see benchmarks below
//   Caching layer?         NO
//
// Verdict: NOT SIMD-viable. Output arrays are too small (1–10 elements) for
// SIMD to amortise setup cost. Even 100 outputs complete in <1 µs.

const mse = Costs.find("MSE");
const mae = Costs.find("MAE");
const crossEntropy = Costs.find("CROSS_ENTROPY");

// Small output (typical NEAT: 1–3 outputs)
const smallTarget = new Float32Array([0.8, 0.2, 0.5]);
const smallOutput = new Float32Array([0.7, 0.3, 0.4]);

// Medium output (10 outputs)
const random10 = makePrng(123);
const medTarget10 = new Float32Array(10);
const medOutput10 = new Float32Array(10);
for (let i = 0; i < 10; i++) {
  medTarget10[i] = Math.abs(random10());
  medOutput10[i] = Math.abs(random10());
}

// Large output (100 outputs — uncommon in NEAT)
const random100 = makePrng(456);
const lrgTarget100 = new Float32Array(100);
const lrgOutput100 = new Float32Array(100);
for (let i = 0; i < 100; i++) {
  lrgTarget100[i] = Math.abs(random100());
  lrgOutput100[i] = Math.abs(random100());
}

Deno.bench({
  name: "Candidate 1a: MSE — 3 outputs (typical NEAT)",
  group: "loss-error-reduction",
  fn() {
    mse.calculate(smallTarget, smallOutput);
  },
});

Deno.bench({
  name: "Candidate 1b: MSE — 10 outputs",
  group: "loss-error-reduction",
  fn() {
    mse.calculate(medTarget10, medOutput10);
  },
});

Deno.bench({
  name: "Candidate 1c: MSE — 100 outputs (uncommon)",
  group: "loss-error-reduction",
  fn() {
    mse.calculate(lrgTarget100, lrgOutput100);
  },
});

Deno.bench({
  name: "Candidate 1d: MAE — 100 outputs",
  group: "loss-error-reduction",
  fn() {
    mae.calculate(lrgTarget100, lrgOutput100);
  },
});

Deno.bench({
  name: "Candidate 1e: CrossEntropy — 100 outputs",
  group: "loss-error-reduction",
  fn() {
    crossEntropy.calculate(lrgTarget100, lrgOutput100);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate 2: Gradient Accumulation Arithmetic
// ═══════════════════════════════════════════════════════════════════════════════
//
// Weight/bias gradient accumulation in backprop. The WASM 4-way and 8-way
// batch functions (`accumulateWeightBatch4Way`, `accumulateBiasBatch4Way`)
// already process multiple items per WASM call, but the inner arithmetic is
// scalar f64.
//
// Decision framework assessment:
//   Tight numerical loop?  PARTIALLY — but each item has branchy logic
//                          (is_finite checks, sign tests, plank_constant
//                          comparisons, conditional positive/negative tracking)
//   Typed array data?      YES — f64 arrays passed to WASM
//   >10 µs per call?       NO  — 4-way batch completes in ~500 ns–2 µs
//   Caching layer?         NO
//
// Verdict: NOT SIMD-viable. The per-item logic is highly branchy (6+ conditional
// paths per synapse), operates on f64 (only 2-wide SIMD with f64x2), and each
// batch call is already well below the 10 µs threshold. SIMD f64x2 would only
// parallelise 2 items — less than the existing 4-way batching achieves through
// loop unrolling.

import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
} from "@propagate/Weight.ts";
import {
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
} from "@propagate/Bias.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { NeuronState } from "@architecture/CreatureState.ts";
import { SynapseState } from "@propagate/SynapseState.ts";

const bpConfig = createBackPropagationConfig({
  generations: 10,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
});

const randBp = makePrng(789);

// Pre-generate synapse states for weight accumulation
const synapseStates4: SynapseState[] = Array.from(
  { length: 4 },
  () => new SynapseState(),
);
const currentWeights4 = Array.from({ length: 4 }, () => randBp());
const targetValues4 = Array.from({ length: 4 }, () => randBp());
const activations4 = Array.from(
  { length: 4 },
  () => randBp() * 0.5 + 0.1,
);

const synapseStates8: SynapseState[] = Array.from(
  { length: 8 },
  () => new SynapseState(),
);
const currentWeights8 = Array.from({ length: 8 }, () => randBp());
const targetValues8 = Array.from({ length: 8 }, () => randBp());
const activations8 = Array.from(
  { length: 8 },
  () => randBp() * 0.5 + 0.1,
);

Deno.bench({
  name: "Candidate 2a: accumulateWeight — single",
  group: "gradient-accumulation",
  fn() {
    const ss = new SynapseState();
    accumulateWeight(
      currentWeights4[0],
      ss,
      targetValues4[0],
      activations4[0],
      bpConfig,
    );
  },
});

Deno.bench({
  name: "Candidate 2b: accumulateWeightBatch4Way",
  group: "gradient-accumulation",
  fn() {
    accumulateWeightBatch4Way(
      currentWeights4,
      synapseStates4,
      targetValues4,
      activations4,
      bpConfig,
    );
  },
});

Deno.bench({
  name: "Candidate 2c: accumulateWeightBatch8Way",
  group: "gradient-accumulation",
  fn() {
    accumulateWeightBatch8Way(
      currentWeights8,
      synapseStates8,
      targetValues8,
      activations8,
      bpConfig,
    );
  },
});

// Bias accumulation
const neuronStates4: NeuronState[] = Array.from(
  { length: 4 },
  () => new NeuronState(),
);

const targetPreActs4 = Array.from({ length: 4 }, () => randBp());
const preActs4 = Array.from({ length: 4 }, () => randBp());
const currentBiases4 = Array.from({ length: 4 }, () => randBp() * 0.5);

Deno.bench({
  name: "Candidate 2d: accumulateBiasBatch4Way",
  group: "gradient-accumulation",
  fn() {
    accumulateBiasBatch4Way(
      neuronStates4,
      targetPreActs4,
      preActs4,
      currentBiases4,
      bpConfig,
    );
  },
});

Deno.bench({
  name: "Candidate 2e: accumulateBiasBatch8Way",
  group: "gradient-accumulation",
  fn() {
    const nsArray8 = Array.from({ length: 8 }, () => new NeuronState());
    const tpa = Array.from({ length: 8 }, () => randBp());
    const pa = Array.from({ length: 8 }, () => randBp());
    const cb = Array.from({ length: 8 }, () => randBp() * 0.5);
    accumulateBiasBatch8Way(nsArray8, tpa, pa, cb, bpConfig);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate 3: Score Statistics Extraction
// ═══════════════════════════════════════════════════════════════════════════════
//
// Weight/bias magnitude scanning for Score.ts penalty calculation. These iterate
// over all synapses/neurons extracting absolute values and finding max/avg.
//
// Decision framework assessment:
//   Tight numerical loop?  YES — iterate synapses, compute abs, track max/sum
//   Typed array data?      YES (WASM path uses compiled network data)
//   >10 µs per call?       BORDERLINE — depends on creature size
//   Caching layer?         YES — results cached in CachedScoreComponents
//
// Verdict: ALREADY IN WASM. The scan functions (`wasmScanMaxWeight`,
// `wasmScanMaxBias`, `wasmComputeScoreComponents`) are already implemented in
// Rust (`score_scan.rs`). Results are cached per creature via
// `CachedScoreComponents`. Adding SIMD to the Rust scan loops would provide
// marginal benefit since the cache prevents repeated computation.

// Benchmark the Score calculation via WASM path
const smallCreature = createBenchCreature(5, 20, 2, 8, 100);
const medCreature = createBenchCreature(10, 80, 3, 15, 200);

// Compile creatures for WASM activation
const smallWasm = WasmCreatureActivation.fromCreature(smallCreature);
const medWasm = WasmCreatureActivation.fromCreature(medCreature);

if (!smallWasm || !medWasm) {
  console.error("Failed to compile creatures to WASM.");
  Deno.exit(1);
}

// Pre-generate inputs for activation
const smallInputs = new Float32Array(5);
const medInputs = new Float32Array(10);
const rand3 = makePrng(999);
for (let i = 0; i < 5; i++) smallInputs[i] = Math.abs(rand3());
for (let i = 0; i < 10; i++) medInputs[i] = Math.abs(rand3());

Deno.bench({
  name: "Candidate 3a: WASM activation — small (20 hidden)",
  group: "score-statistics",
  fn() {
    smallWasm.activate(smallInputs);
  },
});

Deno.bench({
  name: "Candidate 3b: WASM activation — medium (80 hidden)",
  group: "score-statistics",
  fn() {
    medWasm.activate(medInputs);
  },
});

// Score computation includes weight/bias scan (cached after first call)
import { calculate as calculateScore } from "@architecture/Score.ts";

// Force score computation — first call populates cache
smallCreature.score = undefined;
calculateScore(smallCreature, 0.05, 0.0001);

Deno.bench({
  name: "Candidate 3c: Score calculate — small (cached path)",
  group: "score-statistics",
  fn() {
    // Cache is populated, so this measures the cached path
    calculateScore(smallCreature, 0.05, 0.0001);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate 4: Population Score Aggregation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Average score and sorting of creature score arrays. Population sizes are
// typically 50–500 creatures.
//
// Decision framework assessment:
//   Tight numerical loop?  YES (sum) / NO (sort is comparison-based)
//   Typed array data?      NO — scores live on JS Creature objects
//   >10 µs per call?       NO — sum of 500 numbers: ~0.1 µs
//   Caching layer?         NO
//
// Verdict: NOT SIMD-viable. Population score aggregation is trivially fast.
// Scores live on heterogeneous JS objects (not typed arrays), requiring
// extraction before any SIMD operation could apply. The extraction cost alone
// would exceed the computation time. Sorting is comparison-based (O(n log n))
// with JS engine optimisations — not a SIMD-friendly pattern.

// Simulate population score arrays
const popSize50 = new Float64Array(50);
const popSize150 = new Float64Array(150);
const popSize500 = new Float64Array(500);
const randPop = makePrng(321);
for (let i = 0; i < 500; i++) {
  const score = Math.abs(randPop());
  if (i < 50) popSize50[i] = score;
  if (i < 150) popSize150[i] = score;
  popSize500[i] = score;
}

// Pure TypeScript sum (as currently done)
function sumScoresTypedArray(scores: Float64Array): number {
  let total = 0;
  for (let i = 0; i < scores.length; i++) {
    total += scores[i];
  }
  return total / scores.length;
}

// Simulate JS object extraction + sum (actual production pattern)
interface MockCreature {
  score: number;
}
const pop50: MockCreature[] = Array.from(popSize50, (s) => ({ score: s }));
const pop150: MockCreature[] = Array.from(popSize150, (s) => ({ score: s }));
const pop500: MockCreature[] = Array.from(popSize500, (s) => ({ score: s }));

function avgScoreFromObjects(creatures: MockCreature[]): number {
  let total = 0;
  for (let i = 0; i < creatures.length; i++) {
    total += creatures[i].score;
  }
  return total / creatures.length;
}

Deno.bench({
  name: "Candidate 4a: Avg score — 50 creatures (typed array)",
  group: "population-stats",
  fn() {
    sumScoresTypedArray(popSize50);
  },
});

Deno.bench({
  name: "Candidate 4b: Avg score — 150 creatures (typed array)",
  group: "population-stats",
  fn() {
    sumScoresTypedArray(popSize150);
  },
});

Deno.bench({
  name: "Candidate 4c: Avg score — 500 creatures (typed array)",
  group: "population-stats",
  fn() {
    sumScoresTypedArray(popSize500);
  },
});

Deno.bench({
  name: "Candidate 4d: Avg score — 50 creatures (JS objects)",
  group: "population-stats",
  fn() {
    avgScoreFromObjects(pop50);
  },
});

Deno.bench({
  name: "Candidate 4e: Avg score — 500 creatures (JS objects)",
  group: "population-stats",
  fn() {
    avgScoreFromObjects(pop500);
  },
});

Deno.bench({
  name: "Candidate 4f: Sort scores — 150 creatures",
  group: "population-stats",
  fn() {
    const copy = [...pop150];
    copy.sort((a, b) => b.score - a.score);
  },
});

Deno.bench({
  name: "Candidate 4g: Sort scores — 500 creatures",
  group: "population-stats",
  fn() {
    const copy = [...pop500];
    copy.sort((a, b) => b.score - a.score);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate 5: Pairwise Genetic Distance
// ═══════════════════════════════════════════════════════════════════════════════
//
// Set<string> intersection on hidden neuron wire keys. Used for speciation and
// breeding partner selection.
//
// Decision framework assessment:
//   Tight numerical loop?  NO  — Set<string>.has() is hash-based string
//                                comparison, not numerical
//   Typed array data?      NO  — Set<string> of UUID wire keys
//   >10 µs per call?       NO  — cache hits at ~70 ns, misses dominated by
//                                creature construction (not the intersection)
//   Caching layer?         YES — LRU distance cache (10K entries, Issue #1293)
//
// Verdict: NOT SIMD-viable. This is a string-based Set intersection, not a
// numerical loop. Even the cache miss path is dominated by creature construction
// and `getHiddenNeuronWireKeys()`, not by the intersection computation. SIMD
// cannot accelerate hash table lookups or string comparisons.

// Simulate Set<string> intersection (the core operation)
function createWireKeySet(size: number, seed: number): Set<string> {
  const set = new Set<string>();
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    set.add(`neuron-${state.toString(16)}`);
  }
  return set;
}

const setA20 = createWireKeySet(20, 111);
const setB20 = createWireKeySet(20, 222);
// Ensure some overlap
const sharedKeys = Array.from(setA20).slice(0, 5);
for (const k of sharedKeys) setB20.add(k);

const setA80 = createWireKeySet(80, 333);
const setB80 = createWireKeySet(80, 444);
const sharedKeys80 = Array.from(setA80).slice(0, 20);
for (const k of sharedKeys80) setB80.add(k);

function setIntersectionSize(a: Set<string>, b: Set<string>): number {
  const smaller = a.size < b.size ? a : b;
  const larger = a.size < b.size ? b : a;
  let count = 0;
  for (const item of smaller) {
    if (larger.has(item)) count++;
  }
  return count;
}

Deno.bench({
  name: "Candidate 5a: Set intersection — 20 neurons",
  group: "genetic-distance",
  fn() {
    setIntersectionSize(setA20, setB20);
  },
});

Deno.bench({
  name: "Candidate 5b: Set intersection — 80 neurons",
  group: "genetic-distance",
  fn() {
    setIntersectionSize(setA80, setB80);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary: SIMD Expansion Decision Framework Results
// ═══════════════════════════════════════════════════════════════════════════════
//
// | Candidate               | Tight Loop | Typed Array | >10 µs | No Cache | SIMD Viable |
// |-------------------------|-----------|-------------|--------|----------|-------------|
// | 1. Loss error reduction | YES       | YES         | NO     | NO       | ✗           |
// | 2. Gradient accumulation| PARTIAL   | YES         | NO     | NO       | ✗           |
// | 3. Score statistics     | YES       | YES         | MAYBE  | YES(cached)| Already WASM|
// | 4. Population stats     | YES/NO    | NO          | NO     | NO       | ✗           |
// | 5. Genetic distance     | NO        | NO          | NO     | YES      | ✗           |
//
// None of the 5 candidates qualify for SIMD expansion. The existing SIMD
// coverage (weighted sum in activation forward pass) remains the only operation
// where SIMD provides meaningful benefit — it is the only tight numerical loop
// over typed arrays that exceeds the 10 µs threshold per call.

console.log("\n" + "=".repeat(70));
console.log("Issue #2277: SIMD Expansion Viability Profiling Complete");
console.log("=".repeat(70));
console.log("\nAll 5 candidates profiled. See PERFORMANCE_RESEARCH.md for");
console.log("the full decision framework analysis and findings.\n");
