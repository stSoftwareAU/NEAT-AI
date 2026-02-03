/**
 * Issue #1291 - Batch Discovery Candidate Validation Performance Benchmark
 *
 * This benchmark measures the performance improvement from batch validation
 * of discovery candidates compared to individual validation calls.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-ffi bench/BatchDiscoveryValidation.ts
 */

import { Creature } from "../src/Creature.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { buildDiscoveryCandidates } from "../src/discovery/DiscoveryCandidates.ts";
import { validateAfterDiscoveryOrThrow } from "../src/discovery/DiscoveryPostValidate.ts";
import { BatchDiscoveryValidator } from "../src/discovery/BatchDiscoveryValidator.ts";
import { TANH } from "../src/methods/activations/types/TANH.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";

console.log("\n" + "=".repeat(70));
console.log("Issue #1291: Batch Discovery Candidate Validation Benchmark");
console.log("=".repeat(70));

// Create a baseline creature for testing
function createBaselineCreature(hiddenCount: number): Creature {
  const layers = [{ count: hiddenCount }];
  const creature = new Creature(10, 3, { layers });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

// Generate mock discovery results with various candidate types
function generateDiscoveryResult(
  base: Creature,
  candidateCount: number,
): DiscoverResult {
  const synapses: CandidateSynapse[] = [];
  const neurons: CandidateNeuron[] = [];
  const squashes: CandidateSquash[] = [];

  const hiddenNeurons = base.neurons.filter((n) => n.type === "hidden");
  const inputCount = base.input;

  // Generate synapse candidates
  const synapseCount = Math.floor(candidateCount * 0.4);
  for (let i = 0; i < synapseCount; i++) {
    const fromIdx = i % inputCount;
    const toIdx = i % hiddenNeurons.length;
    if (hiddenNeurons[toIdx]?.uuid) {
      synapses.push({
        fromNeuronUUID: `input-${fromIdx}`,
        toNeuronUUID: hiddenNeurons[toIdx].uuid!,
        weight: Math.random() * 2 - 1,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: Math.random() * 0.3,
        improvedCount: Math.floor(Math.random() * 10),
        totalCount: 10,
      });
    }
  }

  // Generate neuron candidates
  const neuronCount = Math.floor(candidateCount * 0.3);
  for (let i = 0; i < neuronCount; i++) {
    const fromIdx = i % inputCount;
    const toIdx = i % hiddenNeurons.length;
    if (hiddenNeurons[toIdx]?.uuid) {
      neurons.push({
        fromNeuronUUID: `input-${fromIdx}`,
        toNeuronUUID: hiddenNeurons[toIdx].uuid!,
        incomingWeight: Math.random() * 2 - 1,
        outgoingWeight: Math.random() * 2 - 1,
        squash: i % 2 === 0 ? TANH.NAME : Mish.NAME,
        bias: Math.random() * 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: Math.random() * 0.4,
        improvedCount: Math.floor(Math.random() * 10),
        totalCount: 10,
      });
    }
  }

  // Generate squash candidates
  const squashCount = Math.floor(candidateCount * 0.3);
  for (let i = 0; i < squashCount; i++) {
    const neuronIdx = i % hiddenNeurons.length;
    if (hiddenNeurons[neuronIdx]?.uuid) {
      squashes.push({
        neuronUUID: hiddenNeurons[neuronIdx].uuid!,
        previousSquash: "IDENTITY",
        squash: i % 2 === 0 ? TANH.NAME : Mish.NAME,
        expectedCreatureScoreGain: Math.random() * 0.5,
        improvedError: Math.random() * 0.1,
        currentError: Math.random() * 0.3,
      });
    }
  }

  return {
    ID: `BENCH-${Date.now()}`,
    addHelpfulSynapses: synapses,
    addHelpfulNeurons: neurons,
    candidateSquashes: squashes,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
  };
}

// ============================================================================
// BENCHMARK SETUP
// ============================================================================

// Small creature (50 neurons) - representative of early evolution
const smallCreature = createBaselineCreature(50);
const smallDiscovery = generateDiscoveryResult(smallCreature, 20);
const smallCandidates = buildDiscoveryCandidates(
  smallCreature,
  smallDiscovery,
  {
    skipCombinedCandidates: true,
  },
);

// Medium creature (200 neurons) - typical mid-evolution
const mediumCreature = createBaselineCreature(200);
const mediumDiscovery = generateDiscoveryResult(mediumCreature, 50);
const mediumCandidates = buildDiscoveryCandidates(
  mediumCreature,
  mediumDiscovery,
  { skipCombinedCandidates: true },
);

// Large creature (500 neurons) - complex networks
const largeCreature = createBaselineCreature(500);
const largeDiscovery = generateDiscoveryResult(largeCreature, 100);
const largeCandidates = buildDiscoveryCandidates(
  largeCreature,
  largeDiscovery,
  {
    skipCombinedCandidates: true,
  },
);

console.log(`\nBenchmark setup complete:`);
console.log(
  `  Small creature: ${smallCreature.neurons.length} neurons, ${smallCandidates.length} candidates`,
);
console.log(
  `  Medium creature: ${mediumCreature.neurons.length} neurons, ${mediumCandidates.length} candidates`,
);
console.log(
  `  Large creature: ${largeCreature.neurons.length} neurons, ${largeCandidates.length} candidates`,
);
console.log();

// ============================================================================
// SMALL CREATURE BENCHMARKS
// ============================================================================

Deno.bench({
  name: "Small (50 neurons): Individual validation (baseline)",
  group: "small-creature",
  baseline: true,
}, () => {
  for (const candidate of smallCandidates) {
    try {
      validateAfterDiscoveryOrThrow({
        baseCreature: smallCreature,
        discoveredCreature: candidate.creature,
        discoveryID: "BENCH",
        operation: candidate.change.type,
        feedbackLoop: false,
      });
    } catch {
      // Ignore validation failures - we're measuring speed
    }
  }
});

Deno.bench({
  name: "Small (50 neurons): Batch validation",
  group: "small-creature",
}, () => {
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
  });
  validator.validateBatch(smallCreature, smallCandidates);
});

Deno.bench({
  name: "Small (50 neurons): Batch with caching (pre-warmed)",
  group: "small-creature",
}, () => {
  // Create validator once and reuse (simulating warm cache scenario)
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
  });
  // First pass warms the cache
  validator.validateBatch(smallCreature, smallCandidates);
  // Second pass benefits from cache
  validator.validateBatch(smallCreature, smallCandidates);
});

// ============================================================================
// MEDIUM CREATURE BENCHMARKS
// ============================================================================

Deno.bench({
  name: "Medium (200 neurons): Individual validation (baseline)",
  group: "medium-creature",
  baseline: true,
}, () => {
  for (const candidate of mediumCandidates) {
    try {
      validateAfterDiscoveryOrThrow({
        baseCreature: mediumCreature,
        discoveredCreature: candidate.creature,
        discoveryID: "BENCH",
        operation: candidate.change.type,
        feedbackLoop: false,
      });
    } catch {
      // Ignore validation failures
    }
  }
});

Deno.bench({
  name: "Medium (200 neurons): Batch validation",
  group: "medium-creature",
}, () => {
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
  });
  validator.validateBatch(mediumCreature, mediumCandidates);
});

Deno.bench({
  name: "Medium (200 neurons): Batch with early exit",
  group: "medium-creature",
}, () => {
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
    earlyExitOnStructuralFailure: true,
  });
  validator.validateBatch(mediumCreature, mediumCandidates);
});

// ============================================================================
// LARGE CREATURE BENCHMARKS
// ============================================================================

Deno.bench({
  name: "Large (500 neurons): Individual validation (baseline)",
  group: "large-creature",
  baseline: true,
}, () => {
  for (const candidate of largeCandidates) {
    try {
      validateAfterDiscoveryOrThrow({
        baseCreature: largeCreature,
        discoveredCreature: candidate.creature,
        discoveryID: "BENCH",
        operation: candidate.change.type,
        feedbackLoop: false,
      });
    } catch {
      // Ignore validation failures
    }
  }
});

Deno.bench({
  name: "Large (500 neurons): Batch validation",
  group: "large-creature",
}, () => {
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
  });
  validator.validateBatch(largeCreature, largeCandidates);
});

Deno.bench({
  name: "Large (500 neurons): Batch with caching",
  group: "large-creature",
}, () => {
  const validator = new BatchDiscoveryValidator({
    feedbackLoop: false,
  });
  // Warm the cache
  validator.validateBatch(largeCreature, largeCandidates);
  // Benefit from cache
  validator.validateBatch(largeCreature, largeCandidates);
});

console.log("=".repeat(70) + "\n");
