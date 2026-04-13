/**
 * Issue #2274 - Profile evolveDir per-generation phase timing.
 *
 * Systematic benchmark that captures phase timing breakdowns across
 * representative creature and population sizes to identify dominant
 * bottlenecks in the evolution loop.
 *
 * Configurations tested:
 *   - Small:  ~10 neurons    × population 50, 150
 *   - Medium: ~30 neurons    × population 50, 150
 *   - Large:  ~80 neurons    × population 50, 150
 *
 * Each configuration runs for at least 10 generations and reports
 * per-phase timing as both absolute milliseconds and percentage
 * of totalMs.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/EvolveDirPhaseProfile.ts
 */

import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Generate a simple training set for benchmarking.
 * Uses a deterministic pattern scaled to the I/O size.
 */
function generateTrainingSet(
  inputCount: number,
  outputCount: number,
  sampleCount: number,
): { input: Float32Array; output: Float32Array }[] {
  const data: { input: Float32Array; output: Float32Array }[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const input = new Float32Array(inputCount);
    const output = new Float32Array(outputCount);

    for (let j = 0; j < inputCount; j++) {
      input[j] = ((i + j) % 3) / 2; // Deterministic values: 0, 0.5, 1
    }
    for (let j = 0; j < outputCount; j++) {
      // Simple target: mean of subset of inputs
      let sum = 0;
      const count = Math.min(3, inputCount);
      for (let k = 0; k < count; k++) sum += input[(j + k) % inputCount];
      output[j] = sum / count;
    }
    data.push({ input, output });
  }
  return data;
}

/**
 * Build a creature of a specified size using mutation operators
 * from a minimal base. This produces valid forward-only creatures
 * with realistic topology.
 */
function buildCreatureOfSize(
  inputCount: number,
  outputCount: number,
  hiddenNeuronTarget: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);

  // Add hidden neurons via AddNeuron mutations
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
      // Some mutations may fail due to constraints — that's expected
    }
    attempts++;
  }

  // Add extra connections for density
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

/** Aggregate timing statistics for a phase. */
interface PhaseStats {
  name: string;
  totalMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  pctOfTotal: number;
}

/** Compute aggregate statistics for a single phase across generations. */
function computePhaseStats(
  name: string,
  values: number[],
  totalMsSum: number,
): PhaseStats {
  const totalMs = values.reduce((a, b) => a + b, 0);
  const meanMs = values.length > 0 ? totalMs / values.length : 0;
  const minMs = values.length > 0 ? Math.min(...values) : 0;
  const maxMs = values.length > 0 ? Math.max(...values) : 0;
  const pctOfTotal = totalMsSum > 0 ? (totalMs / totalMsSum) * 100 : 0;
  return { name, totalMs, meanMs, minMs, maxMs, pctOfTotal };
}

/** Format a number with fixed decimal places. */
function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
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
    totalMsSum += t.totalMs;
  }

  const stats: PhaseStats[] = [];
  for (const [name, values] of Object.entries(phases)) {
    stats.push(computePhaseStats(name, values, totalMsSum));
  }

  // Sort by percentage descending
  stats.sort((a, b) => b.pctOfTotal - a.pctOfTotal);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${label}  (${events.length} generations)`);
  console.log(`${"═".repeat(72)}`);
  console.log(
    `  ${"Phase".padEnd(22)} ${"Mean(ms)".padStart(10)} ${
      "Min(ms)".padStart(10)
    } ${"Max(ms)".padStart(10)} ${"% Total".padStart(10)}`,
  );
  console.log(`  ${"─".repeat(62)}`);

  for (const s of stats) {
    console.log(
      `  ${s.name.padEnd(22)} ${fmt(s.meanMs).padStart(10)} ${
        fmt(s.minMs).padStart(10)
      } ${fmt(s.maxMs).padStart(10)} ${fmt(s.pctOfTotal).padStart(9)}%`,
    );
  }

  const avgTotalMs = totalMsSum / events.length;
  console.log(`  ${"─".repeat(62)}`);
  console.log(
    `  ${"Total (avg)".padEnd(22)} ${fmt(avgTotalMs).padStart(10)}`,
  );

  // Identify top 3 bottlenecks
  console.log(`\n  Top bottlenecks:`);
  for (let i = 0; i < Math.min(3, stats.length); i++) {
    console.log(
      `    ${i + 1}. ${stats[i].name} — ${fmt(stats[i].pctOfTotal)}% of total`,
    );
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
  iterations: number;
}

const configurations: BenchConfig[] = [
  // Small creatures
  {
    label: "Small (~10 neurons) × pop 50",
    inputCount: 3,
    outputCount: 1,
    hiddenNeurons: 6,
    populationSize: 50,
    iterations: 12,
  },
  {
    label: "Small (~10 neurons) × pop 150",
    inputCount: 3,
    outputCount: 1,
    hiddenNeurons: 6,
    populationSize: 150,
    iterations: 12,
  },
  // Medium creatures
  {
    label: "Medium (~30 neurons) × pop 50",
    inputCount: 5,
    outputCount: 2,
    hiddenNeurons: 23,
    populationSize: 50,
    iterations: 12,
  },
  {
    label: "Medium (~30 neurons) × pop 150",
    inputCount: 5,
    outputCount: 2,
    hiddenNeurons: 23,
    populationSize: 150,
    iterations: 12,
  },
  // Large creatures
  {
    label: "Large (~80 neurons) × pop 50",
    inputCount: 8,
    outputCount: 3,
    hiddenNeurons: 69,
    populationSize: 50,
    iterations: 12,
  },
  {
    label: "Large (~80 neurons) × pop 150",
    inputCount: 8,
    outputCount: 3,
    hiddenNeurons: 69,
    populationSize: 150,
    iterations: 12,
  },
];

// ──────────────────────────────────────────────────────────────────
// Benchmark runner using Deno.bench()
// ──────────────────────────────────────────────────────────────────

for (const cfg of configurations) {
  Deno.bench({
    name: `Phase profile: ${cfg.label}`,
    // Single iteration — this is a profiling benchmark, not a micro-benchmark.
    // Each iteration runs cfg.iterations generations internally.
    n: 1,
    warmup: 0,
    fn: async () => {
      const events: GenerationCompleteEvent[] = [];

      const creature = buildCreatureOfSize(
        cfg.inputCount,
        cfg.outputCount,
        cfg.hiddenNeurons,
      );

      const trainingSet = generateTrainingSet(
        cfg.inputCount,
        cfg.outputCount,
        10,
      );

      await creature.evolveDataSet(trainingSet, {
        iterations: cfg.iterations,
        targetError: 0,
        populationSize: cfg.populationSize,
        threads: 1,
        onTrainingEvent: (event: TrainingEvent) => {
          if (event.kind === "generation_complete") {
            events.push(event);
          }
        },
      });

      // Print phase breakdown after the run
      printResultsTable(cfg.label, events);
    },
  });
}
