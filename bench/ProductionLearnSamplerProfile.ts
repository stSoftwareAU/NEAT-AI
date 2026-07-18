/**
 * Issue #3397 — Production learn/sampler profiling bench.
 *
 * Profiles exactly what `worker/learn.sh` (one `src/Learn.ts` run,
 * populationSize=20) and `worker/sampler.sh` (5 `Learn.ts` loops) drive, on
 * the GRQ-cluster production topology captured in the production `network.json`:
 *
 *   1,666 neurons, ~21,513 synapses, 2,461 inputs
 *
 * The synthetic `grq-3397` scale preset in
 * `test/propagate/large/ProductionScaleCreature.ts` reproduces those exact
 * dimensions deterministically (seed 3396), so the profiling command in
 * `docs/PROFILING_REPORT_3397.md` is reproducible and cannot silently rot —
 * the `Benchmark smoke` CI job type-checks every `bench/**` file on each PR.
 *
 * Scoring lane: this bench measures the **JS/WASM** lane (the default, and the
 * fallback lane in production when `NEAT_AI_RUST_SCORER_*` is not exported).
 * The native `rust_scorer` lane runs in a separate process and is profiled in
 * the companion grill stSoftwareAU/NEAT-AI-core#285.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/ProductionLearnSamplerProfile.ts
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
// Production topology from the GRQ-cluster `network.json` (Issue #3397)
// ──────────────────────────────────────────────────────────────────

/** Inputs of the production model. */
const INPUT_COUNT = 2461;
const OUTPUT_COUNT = 2;
/** Deterministic seed that lands on 1,666 neurons / ~21,513 synapses. */
const RNG_SEED = 3396;
/** `learn.sh` production population size. */
const POPULATION_SIZE = 20;
/** Generations profiled per run (kept small so the bench stays a smoke-safe probe). */
const GENERATIONS = 5;

let _creatureExport: CreatureExport | null = null;

function getCreatureExport(): CreatureExport {
  if (!_creatureExport) {
    const rng = createSeededRng(RNG_SEED);
    _creatureExport = generateProductionCreature(
      INPUT_COUNT,
      OUTPUT_COUNT,
      rng,
      { scale: "grq-3397" },
    );
  }
  return _creatureExport;
}

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

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

/**
 * Aggregate the per-generation phase timings into a ranked breakdown and print
 * it. Returns nothing — this is a profiling probe, not an assertion.
 */
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

  const stats = Object.entries(phases).map(([name, values]) => {
    const total = values.reduce((a, b) => a + b, 0);
    return {
      name,
      meanMs: values.length > 0 ? total / values.length : 0,
      pctOfTotal: totalMsSum > 0 ? (total / totalMsSum) * 100 : 0,
    };
  });
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
  console.log(`  ${"Total (avg)".padEnd(22)} ${fmt(avgTotalMs).padStart(12)}`);
}

// ──────────────────────────────────────────────────────────────────
// Bench: full evolveDataSet at production scale (learn.sh 100% loop)
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name:
    `Production learn: evolveDataSet (grq-3397, 2461in/2out) × ${GENERATIONS} gen × pop ${POPULATION_SIZE}`,
  n: 1,
  warmup: 0,
  fn: async () => {
    const creatureExport = getCreatureExport();
    const trainingData = getTrainingData();
    const events: GenerationCompleteEvent[] = [];

    // Confirm the profiled topology matches the production network.json dims.
    console.log(
      `\n  topology: ${creatureExport.neurons.length} neurons, ` +
        `${creatureExport.synapses.length} synapses, ` +
        `${creatureExport.input} inputs`,
    );

    const creature = Creature.fromJSON(creatureExport);
    await creature.evolveDataSet(trainingData, {
      iterations: GENERATIONS,
      targetError: 0,
      populationSize: POPULATION_SIZE,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    printResultsTable(
      `Production learn (grq-3397) × pop ${POPULATION_SIZE}, ${GENERATIONS} gen`,
      events,
    );
  },
});

// ──────────────────────────────────────────────────────────────────
// Bench: single fitness activation (the JS/WASM scoring lane hotspot)
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: "Production learn: single activation (grq-3397, 1666N/21.5kS)",
  fn: () => {
    const creatureExport = getCreatureExport();
    const creature = Creature.fromJSON(creatureExport);
    const sample = getTrainingData()[0];
    creature.activate(sample.input);
  },
});

// ──────────────────────────────────────────────────────────────────
// Bench: serialisation round-trip (per-generation checkpoint I/O cost)
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name: "Production learn: exportJSON round-trip (grq-3397, 1666N/21.5kS)",
  fn: () => {
    const creatureExport = getCreatureExport();
    const creature = Creature.fromJSON(creatureExport);
    const exported = creature.exportJSON();
    Creature.fromJSON(exported);
  },
});
