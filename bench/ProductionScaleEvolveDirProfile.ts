/**
 * Issue #2307 — Production-scale evolveDir phase-timing benchmark.
 *
 * Profiles the evolveDir evolution loop at GRQ-cluster dimensions
 * (~1,500 neurons, ~20,000 synapses, 648 inputs, 2 outputs) to identify
 * which phases dominate wall-clock time at production scale — contrasting
 * with the small-data profiling from #2274 that showed breeding at 50–60%.
 *
 * Individual phases benchmarked:
 *   - Fitness scoring (WASM activation + error calculation)
 *   - Breeding (crossover, alignment, offspring generation)
 *   - De-duplication (Bloom filter + Set)
 *   - Serialisation (exportJSON round-trip)
 *
 * Also runs a full evolveDataSet for 5 generations to capture aggregate
 * phase timing at production scale.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/ProductionScaleEvolveDirProfile.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "../test/propagate/large/ProductionScaleCreature.ts";

// ──────────────────────────────────────────────────────────────────
// Shared production-scale creature and data
// ──────────────────────────────────────────────────────────────────

const INPUT_COUNT = 648;
const OUTPUT_COUNT = 2;
const RNG_SEED = 2307;

/** Lazily cached production creature export. */
let _creatureExport: CreatureExport | null = null;

function getCreatureExport(): CreatureExport {
  if (!_creatureExport) {
    const rng = createSeededRng(RNG_SEED);
    _creatureExport = generateProductionCreature(
      INPUT_COUNT,
      OUTPUT_COUNT,
      rng,
      { scale: "grq-cluster" },
    );
  }
  return _creatureExport;
}

/** Lazily cached training data (small set for bench feasibility). */
let _trainingData: { input: Float32Array; output: Float32Array }[] | null =
  null;

function getTrainingData(): { input: Float32Array; output: Float32Array }[] {
  if (!_trainingData) {
    const rng = createSeededRng(RNG_SEED + 1_000);
    _trainingData = generateTrainingData(INPUT_COUNT, OUTPUT_COUNT, 50, rng);
  }
  return _trainingData;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** Format a number with fixed decimal places. */
function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

/** Compute aggregate statistics for a single phase across generations. */
function computePhaseStats(
  name: string,
  values: number[],
  totalMsSum: number,
): { name: string; meanMs: number; pctOfTotal: number } {
  const totalMs = values.reduce((a, b) => a + b, 0);
  const meanMs = values.length > 0 ? totalMs / values.length : 0;
  const pctOfTotal = totalMsSum > 0 ? (totalMs / totalMsSum) * 100 : 0;
  return { name, meanMs, pctOfTotal };
}

/** Print a results table for one configuration. */
function printResultsTable(
  label: string,
  events: GenerationCompleteEvent[],
): void {
  if (events.length === 0) {
    console.log(`\n  ${label}: no events captured`);
    return;
  }

  const phases: Record<string, number[]> = {
    fitness: [],
    breeding: [],
    resultProcessing: [],
    mutation: [],
    deduplication: [],
    speciation: [],
    writeScores: [],
    memoryEviction: [],
    sort: [],
    preWarm: [],
  };

  let totalMsSum = 0;

  for (const event of events) {
    const t = event.phaseTiming;
    phases.fitness.push(t.fitnessMs);
    phases.breeding.push(t.breedingMs);
    phases.resultProcessing.push(t.resultProcessingMs);
    phases.mutation.push(t.mutationMs ?? 0);
    phases.deduplication.push(t.deduplicationMs ?? 0);
    phases.speciation.push(t.speciationMs ?? 0);
    phases.writeScores.push(t.writeScoresMs ?? 0);
    phases.memoryEviction.push(t.memoryEvictionMs ?? 0);
    phases.sort.push(t.sortMs ?? 0);
    phases.preWarm.push(t.preWarmMs ?? 0);
    totalMsSum += t.totalMs;
  }

  const stats: { name: string; meanMs: number; pctOfTotal: number }[] = [];
  for (const [name, values] of Object.entries(phases)) {
    stats.push(computePhaseStats(name, values, totalMsSum));
  }

  // Sort by percentage descending
  stats.sort((a, b) => b.pctOfTotal - a.pctOfTotal);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${label}  (${events.length} generations)`);
  console.log(`${"═".repeat(72)}`);
  console.log(
    `  ${"Phase".padEnd(22)} ${"Mean(ms)".padStart(12)} ${
      "% Total".padStart(10)
    }`,
  );
  console.log(`  ${"─".repeat(46)}`);

  for (const s of stats) {
    if (s.pctOfTotal > 0.05) {
      console.log(
        `  ${s.name.padEnd(22)} ${fmt(s.meanMs).padStart(12)} ${
          fmt(s.pctOfTotal).padStart(9)
        }%`,
      );
    }
  }

  const avgTotalMs = totalMsSum / events.length;
  console.log(`  ${"─".repeat(46)}`);
  console.log(
    `  ${"Total (avg)".padEnd(22)} ${fmt(avgTotalMs).padStart(12)}`,
  );

  // Identify top 3 bottlenecks
  console.log(`\n  Top bottlenecks:`);
  for (let i = 0; i < Math.min(3, stats.length); i++) {
    if (stats[i].pctOfTotal > 0.05) {
      console.log(
        `    ${i + 1}. ${stats[i].name} — ${
          fmt(stats[i].pctOfTotal)
        }% of total`,
      );
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Benchmark: Full evolveDataSet at production scale
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name:
    "Production-scale evolveDataSet (1492N/19968S, 648in/2out) × 5 gen × pop 20",
  n: 1,
  warmup: 0,
  fn: async () => {
    const creatureExport = getCreatureExport();
    const trainingData = getTrainingData();
    const events: GenerationCompleteEvent[] = [];

    const creature = Creature.fromJSON(creatureExport);

    await creature.evolveDataSet(trainingData, {
      iterations: 5,
      targetError: 0,
      populationSize: 20,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    printResultsTable(
      "Production-scale (1492N/19968S) × pop 20, 5 gen",
      events,
    );
  },
});

// ──────────────────────────────────────────────────────────────────
// Benchmark: Fitness scoring (activation + error) at production scale
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: "Fitness: single activation at production scale (1492N/19968S)",
  fn: () => {
    const creatureExport = getCreatureExport();
    const creature = Creature.fromJSON(creatureExport);
    const trainingData = getTrainingData();
    const sample = trainingData[0];
    creature.activate(sample.input);
  },
});

// ──────────────────────────────────────────────────────────────────
// Benchmark: Serialisation round-trip at production scale
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name:
    "Serialisation: exportJSON round-trip at production scale (1492N/19968S)",
  fn: () => {
    const creatureExport = getCreatureExport();
    const creature = Creature.fromJSON(creatureExport);
    const exported = creature.exportJSON();
    Creature.fromJSON(exported);
  },
});

// ──────────────────────────────────────────────────────────────────
// Benchmark: Creature.fromJSON at production scale
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: "Deserialisation: Creature.fromJSON at production scale (1492N/19968S)",
  fn: () => {
    const creatureExport = getCreatureExport();
    Creature.fromJSON(creatureExport);
  },
});
