/**
 * Issue #2314 - Benchmark phase pipelining in the evolution loop.
 *
 * Measures per-generation wall-clock time and phase timing to demonstrate
 * the benefit of overlapping sequential main-thread phases with worker
 * tasks:
 *   1. Breeding overlapped with result processing + plateau/MCMC config
 *   2. Deduplication overlapped with WASM pre-warming
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/PhasePipelining.ts
 */

import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

/**
 * Generate a deterministic training set for benchmarking.
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
      input[j] = ((i + j) % 3) / 2;
    }
    for (let j = 0; j < outputCount; j++) {
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
 * Build a creature with the specified approximate neuron count.
 */
function buildCreature(
  inputCount: number,
  outputCount: number,
  targetNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);
  const addConnection = new AddConnection(creature);

  for (let i = 0; i < targetNeurons; i++) {
    try {
      addNeuron.mutate();
    } catch {
      break;
    }
  }
  for (let i = 0; i < targetNeurons * 2; i++) {
    try {
      addConnection.mutate();
    } catch {
      break;
    }
  }
  return creature;
}

// ──────────────────────────────────────────────────────────────────
// Benchmarks
// ──────────────────────────────────────────────────────────────────

const configs = [
  { name: "small-pop50", neurons: 10, population: 50, inputs: 4, outputs: 2 },
  {
    name: "medium-pop100",
    neurons: 30,
    population: 100,
    inputs: 8,
    outputs: 3,
  },
  {
    name: "large-pop150",
    neurons: 60,
    population: 150,
    inputs: 12,
    outputs: 4,
  },
];

for (const config of configs) {
  Deno.bench(
    `PhasePipelining: ${config.name} (${config.neurons}n × ${config.population}pop)`,
    { group: "phase-pipelining", warmup: 1, n: 3 },
    async () => {
      const events: GenerationCompleteEvent[] = [];
      const trainingSet = generateTrainingSet(
        config.inputs,
        config.outputs,
        20,
      );
      const creature = buildCreature(
        config.inputs,
        config.outputs,
        config.neurons,
      );

      await creature.evolveDataSet(trainingSet, {
        iterations: 5,
        targetError: 0.0001,
        populationSize: config.population,
        threads: 1,
        onTrainingEvent: (event: TrainingEvent) => {
          if (event.kind === "generation_complete") {
            events.push(event);
          }
        },
      });

      // Log phase timing breakdown for the last generation
      if (events.length > 0) {
        const last = events[events.length - 1].phaseTiming;
        console.log(
          `  [${config.name}] breeding=${last.breedingMs}ms ` +
            `resultProcessing=${last.resultProcessingMs}ms ` +
            `mutation=${last.mutationMs ?? 0}ms ` +
            `dedup=${last.deduplicationMs ?? 0}ms ` +
            `preWarm=${last.preWarmMs ?? 0}ms ` +
            `total=${last.totalMs}ms`,
        );
      }
    },
  );
}
