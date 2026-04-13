/**
 * WASM Migration Analysis for evolveDir Hotspots
 *
 * Issue #2278: Systematically evaluates whether remaining TypeScript hotspots
 * in the evolveDir pipeline would benefit from Rust/WASM migration.
 *
 * Applies the decision framework from PERFORMANCE_RESEARCH.md:
 * 1. Is it a tight numerical loop? → WASM candidate
 * 2. Is data already in typed arrays / can be cheaply converted? → WASM candidate
 * 3. Does it take >10 µs per call? → worth the boundary crossing
 * 4. Is there a caching layer that already short-circuits it? → not a WASM candidate
 *
 * Profiling results from Issue #2274 show phase breakdown:
 * - Breeding: 50–60% of generation time (dominant hotspot)
 * - Fitness evaluation: 13–19% (already WASM-accelerated)
 * - Mutation: 4–10%
 * - De-duplication: 6–9%
 * - Speciation: <1%
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/EvolveDirWasmMigrationAnalysis.ts
 */

import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { clearDistanceCache } from "@breed/DistanceCache.ts";
import { Costs } from "@costs";

// ── Test fixtures ──────────────────────────────────────────────────────────

function createCreature(
  inputs: number,
  outputs: number,
  layers: { count: number }[],
): Creature {
  const creature = new Creature(inputs, outputs, { layers });
  creatureValidate(creature);
  return creature;
}

// Small creatures (~20 neurons, typical minimal NEAT network)
const smallMum = createCreature(5, 3, [{ count: 8 }, { count: 4 }]);
const smallDad = createCreature(5, 3, [{ count: 6 }, { count: 5 }]);

// Medium creatures (~80 neurons)
const medMum = createCreature(20, 10, [{ count: 30 }, { count: 20 }]);
const medDad = createCreature(20, 10, [{ count: 25 }, { count: 15 }]);

console.log("=== Creature Sizes (Issue #2278) ===");
console.log(
  `Small: ${smallMum.neurons.length}n/${smallMum.synapses.length}s, ` +
    `${smallDad.neurons.length}n/${smallDad.synapses.length}s`,
);
console.log(
  `Medium: ${medMum.neurons.length}n/${medMum.synapses.length}s, ` +
    `${medDad.neurons.length}n/${medDad.synapses.length}s`,
);

// ═══════════════════════════════════════════════════════════════════════════
// Operation 1: Breeding / Crossover (50–60% of generation time)
//
// Decision framework:
//   ✗ Tight numerical loop? NO — graph manipulation with Map lookups
//   ✗ Typed array data? NO — Map<number, Neuron>, ConnectionRef, Set<number>
//   ✓ >10 µs per call? YES — dominant time consumer
//   ✗ Caching layer? NO (but deferred ConnectionRef optimisation exists)
//
// Verdict: NOT a WASM candidate. The serialisation wall applies — previous
// investigation #1632 confirmed 99%+ of end-to-end time in serialisation.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op1 Breed: Small offspring (~20n)",
  group: "evolveDir-wasm-analysis",
  baseline: true,
  fn() {
    Offspring.breed(smallMum, smallDad);
  },
});

Deno.bench({
  name: "Op1 Breed: Medium offspring (~80n)",
  group: "evolveDir-wasm-analysis",
  fn() {
    Offspring.breed(medMum, medDad);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 2: Fitness Evaluation — JS Cost Functions (13–19%)
//
// Decision framework:
//   ✓ Tight numerical loop? YES — per-element arithmetic over output arrays
//   ✓ Typed array data? YES — Float32Array inputs and outputs
//   ? >10 µs per call? Depends on output size (small outputs < 1 µs)
//   ✗ Caching layer? NO
//
// Verdict: ALREADY IN WASM. The fused batch loss functions
// (mseSumBatchPacked, etc.) in wasm_activation/src/loss.rs are used for
// all forward-only creatures via evaluateDir(). JS cost functions are
// only a fallback for unsupported cost types or non-forward-only networks.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op2 JS Cost MSE: 10 outputs",
  group: "js-cost-functions",
  baseline: true,
  fn() {
    const cost = Costs.find("MSE");
    const target = new Float32Array(10).fill(0.5);
    const output = new Float32Array(10).fill(0.6);
    cost.calculate(target, output);
  },
});

Deno.bench({
  name: "Op2 JS Cost MSE: 100 outputs",
  group: "js-cost-functions",
  fn() {
    const cost = Costs.find("MSE");
    const target = new Float32Array(100).fill(0.5);
    const output = new Float32Array(100).fill(0.6);
    cost.calculate(target, output);
  },
});

Deno.bench({
  name: "Op2 JS Cost CrossEntropy: 10 outputs",
  group: "js-cost-functions",
  fn() {
    const cost = Costs.find("CROSS_ENTROPY");
    const target = new Float32Array(10).fill(0.5);
    const output = new Float32Array(10).fill(0.6);
    cost.calculate(target, output);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 3: Genetic Compatibility (used during breeding / speciation)
//
// Decision framework:
//   ✗ Tight numerical loop? NO — set intersection on UUID strings
//   ✗ Typed array data? NO — Set<string> of neuron wire keys
//   ✗ >10 µs per call? NO — cache hits at 66 ns, misses at ~521 ns
//   ✓ Caching layer? YES — LRU distance cache (10K entries)
//
// Verdict: NOT a WASM candidate. Cache-dominated path. The LRU cache
// already eliminates most redundant work at 66 ns per hit, well below
// WASM boundary crossing cost.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op3 Compatibility: cache hit (same pair)",
  group: "genetic-compatibility",
  baseline: true,
  fn() {
    // After the first call, subsequent calls hit the distance cache
    geneticCompatibility(smallMum, smallDad);
  },
});

Deno.bench({
  name: "Op3 Compatibility: cache miss (fresh creatures)",
  group: "genetic-compatibility",
  fn() {
    // Force cache miss by clearing cache and using fresh creatures
    clearDistanceCache();
    const a = createCreature(5, 3, [{ count: 8 }]);
    const b = createCreature(5, 3, [{ count: 6 }]);
    geneticCompatibility(a, b);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 4: Mutation (ModWeight / ModBias) — 4–10% of generation time
//
// Decision framework:
//   ✗ Tight numerical loop? NO — O(1) scalar operations per mutation
//   ✗ Typed array data? NO — individual Neuron/Synapse objects
//   ✗ >10 µs per call? NO — trivially fast (~1–2 µs)
//   ✗ Caching layer? NO
//
// Verdict: NOT a WASM candidate. Trivially fast operations where WASM
// boundary crossing cost would exceed computation time.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op4 Mutation: single weight modification",
  group: "mutation-ops",
  baseline: true,
  fn() {
    // Clone a small creature and modify a random synapse weight
    const creature = Creature.fromJSON(smallMum.exportJSON());
    if (creature.synapses.length > 0) {
      const idx = Math.floor(Math.random() * creature.synapses.length);
      creature.synapses[idx].weight += (Math.random() - 0.5) * 0.1;
    }
  },
});

Deno.bench({
  name: "Op4 Mutation: single bias modification",
  group: "mutation-ops",
  fn() {
    const creature = Creature.fromJSON(smallMum.exportJSON());
    // Find a non-input neuron and modify its bias
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input") {
        neuron.bias += (Math.random() - 0.5) * 0.1;
        break;
      }
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 5: De-duplication (Bloom Filter + Set) — 6–9% of generation time
//
// Decision framework:
//   ✗ Tight numerical loop? NO — Bloom filter hash checks + Set operations
//   ✗ Typed array data? NO — UUID strings, Set<string>
//   ✓ >10 µs per call? YES — scales with population size
//   ✗ Caching layer? Bloom filter is the fast path itself
//
// Verdict: NOT a WASM candidate. String hashing and set membership are not
// numerical computations. The Bloom filter already provides fast rejection.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op5 DeDup: UUID computation for creature",
  group: "dedup-ops",
  baseline: true,
  fn() {
    // The first step of de-duplication: compute creature UUID
    const creature = Creature.fromJSON(smallMum.exportJSON());
    // Access uuid to trigger computation
    const _uuid = creature.uuid;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 6: Speciation (Genus assignment) — <1% of generation time
//
// Decision framework:
//   ✗ Tight numerical loop? NO — architecture bucketing with string ops
//   ✗ Typed array data? NO — neuron objects, string concatenation
//   ✗ >10 µs per call? NO — negligible time (<1% of generation)
//   ✗ Caching layer? Architecture key is computed per creature
//
// Verdict: NOT a WASM candidate. Already fast and negligible in profiling.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op6 Speciation: architecture key computation",
  group: "speciation-ops",
  baseline: true,
  fn() {
    // Speciation classifies creatures by architecture fingerprint
    const creature = Creature.fromJSON(smallMum.exportJSON());
    // getTopologyHash is used for speciation bucketing
    const _hash = CreatureUtil.getTopologyHash(creature);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Operation 7: WASM Activation (baseline — already in WASM)
//
// For comparison: the activation function IS in WASM and shows the kind of
// operation that benefits from WASM migration.
// ═══════════════════════════════════════════════════════════════════════════

Deno.bench({
  name: "Op7 WASM Activation: small creature forward pass",
  group: "wasm-baseline",
  baseline: true,
  fn() {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    smallMum.activate(input, false);
  },
});

Deno.bench({
  name: "Op7 WASM Activation: medium creature forward pass",
  group: "wasm-baseline",
  fn() {
    const input = new Float32Array(20);
    for (let i = 0; i < 20; i++) input[i] = Math.random();
    medMum.activate(input, false);
  },
});
