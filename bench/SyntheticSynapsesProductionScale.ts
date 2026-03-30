/**
 * Benchmark for synthetic synapse operations at production scale.
 *
 * Issue #1924: Measures the time for generating synthetic synapses,
 * running a single backpropagation pass with the expanded network,
 * and pruning afterwards on a production-sized creature (~1,000+
 * neurons, ~18,000+ synapses).
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/SyntheticSynapsesProductionScale.ts
 */
import { Creature } from "../src/Creature.ts";
import { generateSyntheticSynapses } from "@propagate/SyntheticSynapses.ts";
import { removeSyntheticSynapses } from "@propagate/RemoveSyntheticSynapses.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "../test/propagate/large/ProductionScaleCreature.ts";
import { train } from "../test/TrainTestOnlyUtil.ts";

// Pre-generate the production creature and training data outside benchmarks.
const rng = createSeededRng(42);
const creatureJson = generateProductionCreature(10, 3, rng);
const dataRng = createSeededRng(123);
const trainingData = generateTrainingData(10, 3, 30, dataRng);

// ---------------------------------------------------------------------------
// Benchmark 1: Synthetic synapse generation (capped)
// ---------------------------------------------------------------------------

Deno.bench({
  name: "synthetic synapses: generate (capped, production scale)",
  group: "synthetic-synapses",
  fn() {
    const creature = Creature.fromJSON(creatureJson);
    generateSyntheticSynapses(creature);
  },
});

// ---------------------------------------------------------------------------
// Benchmark 2: Synthetic synapse removal
// ---------------------------------------------------------------------------

Deno.bench({
  name: "synthetic synapses: remove after generation (production scale)",
  group: "synthetic-synapses",
  fn() {
    const creature = Creature.fromJSON(creatureJson);
    const { syntheticKeys } = generateSyntheticSynapses(creature);
    creature.clearState();
    removeSyntheticSynapses(creature, syntheticKeys);
  },
});

// ---------------------------------------------------------------------------
// Benchmark 3: Full lifecycle — generate, train (1 iteration), remove
// ---------------------------------------------------------------------------

Deno.bench({
  name: "synthetic synapses: full lifecycle (generate + train + remove)",
  group: "synthetic-synapses",
  fn() {
    const creature = Creature.fromJSON(creatureJson);
    train(creature, trainingData, {
      targetError: 0.01,
      iterations: 1,
      learningRate: 0.1,
      disableRandomSamples: true,
      generations: 0,
      maximumBiasAdjustmentScale: 1,
      maximumWeightAdjustmentScale: 1,
      normaliseGradients: true,
      sparseRatio: 1,
      syntheticSynapses: true,
    });
  },
});

// ---------------------------------------------------------------------------
// Benchmark 4: Training without synthetic synapses (baseline)
// ---------------------------------------------------------------------------

Deno.bench({
  name: "training: baseline without synthetic synapses (production scale)",
  group: "synthetic-synapses",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(creatureJson);
    train(creature, trainingData, {
      targetError: 0.01,
      iterations: 1,
      learningRate: 0.1,
      disableRandomSamples: true,
      generations: 0,
      maximumBiasAdjustmentScale: 1,
      maximumWeightAdjustmentScale: 1,
      normaliseGradients: true,
      sparseRatio: 1,
      syntheticSynapses: false,
    });
  },
});
