/**
 * Issue #2284 — Profile breeding sub-phase timing.
 *
 * Dedicated benchmark that directly measures sub-phase timing within
 * `Offspring.breed()` using the `BreedingSubPhaseAccumulator`. This
 * bypasses the worker pool to capture internal algorithm timings
 * (workers run `Offspring.breed()` in a separate thread without
 * accumulator access).
 *
 * Profiles six sub-operations:
 *   1. Parent selection (via FitnessRanking)
 *   2. Genetic compatibility calculation
 *   3. Genome alignment & crossover (neuron map building)
 *   4. sortNeurons (dependency-aware ordering)
 *   5. Batch connection building (dedup)
 *   6. Post-breeding repair (forward-only, UUID uniqueness)
 *
 * Configurations match PR #2281 methodology:
 *   - Small:  ~10 neurons
 *   - Medium: ~30 neurons
 *   - Large:  ~80 neurons
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/BreedingSubPhaseProfile.ts
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { ParallelBreeding } from "@breed/ParallelBreeding.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import type { BreedingSubPhaseTiming } from "@config/TrainingEvent.ts";

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Build a creature of a specified size using mutation operators
 * from a minimal base. Produces valid forward-only creatures
 * with realistic topology.
 */
function buildCreatureOfSize(
  inputCount: number,
  outputCount: number,
  hiddenNeuronTarget: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);

  let attempts = 0;
  while (
    creature.neurons.length - inputCount - outputCount < hiddenNeuronTarget &&
    attempts < hiddenNeuronTarget * 10
  ) {
    try {
      const addNeuron = new AddNeuron(creature);
      addNeuron.mutate();
      creature.fix();
    } catch {
      // Some mutations may fail — expected
    }
    attempts++;
  }

  const targetSynapses = Math.min(
    hiddenNeuronTarget * 4,
    creature.neurons.length * (creature.neurons.length - 1) / 4,
  );
  attempts = 0;
  while (creature.synapses.length < targetSynapses && attempts < 5000) {
    try {
      const addConn = new AddConnection(creature);
      addConn.mutate();
      creature.fix();
    } catch {
      // Connection already exists or otherwise invalid
    }
    attempts++;
  }

  return creature;
}

/**
 * Create a diverse population by building multiple creatures of varied sizes.
 * Each creature has unique topology to ensure breeding produces viable offspring.
 */
function createDiversePopulation(
  inputCount: number,
  outputCount: number,
  baseHiddenNeurons: number,
  size: number,
): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    // Vary hidden neuron count for topological diversity
    const hiddenTarget = Math.max(
      2,
      baseHiddenNeurons + (i % 5) - 2,
    );
    const creature = buildCreatureOfSize(inputCount, outputCount, hiddenTarget);
    creature.score = -0.5 + (i / size) * 0.4;
    CreatureUtil.makeUUID(creature);
    population.push(creature);
  }
  return population;
}

/** Format a number with fixed decimal places. */
function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

/** Aggregate timing statistics for a sub-phase. */
interface SubPhaseStats {
  name: string;
  totalMs: number;
  meanMs: number;
  pctOfBreeding: number;
}

/**
 * Print the breeding sub-phase results table.
 */
function printSubPhaseTable(
  label: string,
  timings: BreedingSubPhaseTiming[],
): void {
  if (timings.length === 0) {
    console.log(`\n  ${label}: no successful breedings`);
    return;
  }

  const fields: { key: keyof BreedingSubPhaseTiming; label: string }[] = [
    { key: "parentSelectionMs", label: "parentSelection" },
    { key: "geneticCompatibilityMs", label: "geneticCompatibility" },
    { key: "alignmentCrossoverMs", label: "alignmentCrossover" },
    { key: "sortNeuronsMs", label: "sortNeurons" },
    { key: "batchConnectionMs", label: "batchConnection" },
    { key: "postBreedingRepairMs", label: "postBreedingRepair" },
  ];

  // Sum all sub-phase times to get total breeding time
  let totalBreedingMs = 0;
  const sums: Record<string, number> = {};
  for (const f of fields) {
    sums[f.label] = 0;
  }

  let totalOffspring = 0;
  for (const t of timings) {
    for (const f of fields) {
      const val = t[f.key] as number;
      sums[f.label] += val;
      totalBreedingMs += val;
    }
    totalOffspring += t.offspringCount;
  }

  const stats: SubPhaseStats[] = fields.map((f) => ({
    name: f.label,
    totalMs: sums[f.label],
    meanMs: sums[f.label] / timings.length,
    pctOfBreeding: totalBreedingMs > 0
      ? (sums[f.label] / totalBreedingMs) * 100
      : 0,
  }));

  // Sort by percentage descending
  stats.sort((a, b) => b.pctOfBreeding - a.pctOfBreeding);

  console.log(`\n${"═".repeat(72)}`);
  console.log(
    `  ${label}  (${timings.length} batches, ${totalOffspring} offspring)`,
  );
  console.log(`${"═".repeat(72)}`);
  console.log(
    `  ${"Sub-phase".padEnd(24)} ${"Mean(ms)".padStart(10)} ${
      "Total(ms)".padStart(10)
    } ${"% Breed".padStart(10)}`,
  );
  console.log(`  ${"─".repeat(56)}`);

  for (const s of stats) {
    console.log(
      `  ${s.name.padEnd(24)} ${fmt(s.meanMs).padStart(10)} ${
        fmt(s.totalMs).padStart(10)
      } ${fmt(s.pctOfBreeding).padStart(9)}%`,
    );
  }

  const avgBreedingMs = totalBreedingMs / timings.length;
  console.log(`  ${"─".repeat(56)}`);
  console.log(
    `  ${"Total (avg)".padEnd(24)} ${fmt(avgBreedingMs).padStart(10)} ${
      fmt(totalBreedingMs).padStart(10)
    }`,
  );
  console.log(
    `  ${"Offspring (avg)".padEnd(24)} ${
      fmt(totalOffspring / timings.length, 0).padStart(10)
    }`,
  );

  // Identify top 2–3 hotspots
  console.log(`\n  Top breeding hotspots:`);
  for (let i = 0; i < Math.min(3, stats.length); i++) {
    if (stats[i].pctOfBreeding > 0) {
      console.log(
        `    ${i + 1}. ${stats[i].name} — ${
          fmt(stats[i].pctOfBreeding)
        }% of breeding time`,
      );
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Benchmark configurations
// ──────────────────────────────────────────────────────────────────

interface BenchConfig {
  label: string;
  inputCount: number;
  outputCount: number;
  hiddenNeurons: number;
  populationSize: number;
  breedingBatches: number;
  batchSize: number;
}

const configurations: BenchConfig[] = [
  // Small creatures
  {
    label: "Small (~10 neurons) × pop 50",
    inputCount: 3,
    outputCount: 1,
    hiddenNeurons: 6,
    populationSize: 50,
    breedingBatches: 10,
    batchSize: 30,
  },
  // Medium creatures
  {
    label: "Medium (~30 neurons) × pop 50",
    inputCount: 5,
    outputCount: 2,
    hiddenNeurons: 23,
    populationSize: 50,
    breedingBatches: 10,
    batchSize: 30,
  },
  // Large creatures
  {
    label: "Large (~80 neurons) × pop 50",
    inputCount: 8,
    outputCount: 3,
    hiddenNeurons: 69,
    populationSize: 50,
    breedingBatches: 10,
    batchSize: 30,
  },
];

// ──────────────────────────────────────────────────────────────────
// Benchmark runner
// ──────────────────────────────────────────────────────────────────

for (const cfg of configurations) {
  Deno.bench({
    name: `Breeding sub-phases: ${cfg.label}`,
    n: 1,
    warmup: 0,
    fn: async () => {
      const population = createDiversePopulation(
        cfg.inputCount,
        cfg.outputCount,
        cfg.hiddenNeurons,
        cfg.populationSize,
      );
      const genus = new Genus();
      for (const creature of population) {
        genus.addCreature(creature);
      }

      const config = createNeatConfig({
        populationSize: cfg.populationSize,
        geneticCompatibilityThreshold: 0.3,
      });

      // Use ParallelBreeding without workers to capture sub-phase timing
      const parallelBreeding = new ParallelBreeding(genus, config);

      const timings: BreedingSubPhaseTiming[] = [];

      // Sequential batches are intentional — each batch must complete before
      // the next to get accurate per-batch sub-phase timing data.
      for (let batch = 0; batch < cfg.breedingBatches; batch++) {
        // deno-lint-ignore no-await-in-loop
        await parallelBreeding.breedBatch(cfg.batchSize);
        if (parallelBreeding.lastBreedingSubPhases) {
          timings.push(parallelBreeding.lastBreedingSubPhases);
        }
      }

      printSubPhaseTable(cfg.label, timings);
    },
  });
}
