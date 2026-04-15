/**
 * Issue #2312 — Profile per-phase worker utilisation during evolution.
 *
 * Production-scale benchmark that runs multiple generations and reports
 * per-phase worker utilisation metrics. This provides the data needed to
 * understand why production CPUs average only ~20% usage and to prioritise
 * concurrency improvements.
 *
 * The benchmark captures:
 *   - Fast-pool utilisation per phase (fitness, breeding)
 *   - Heavy-pool utilisation per phase (discovery, training)
 *   - Overall CPU utilisation estimate per generation
 *   - Phase duration breakdown alongside utilisation
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi --allow-net bench/WorkerUtilisationProfile.ts
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutation } from "@neat/Mutation.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import type {
  GenerationCompleteEvent,
  PhaseWorkerUtilisation,
  TrainingEvent,
  WorkerUtilisationSnapshot,
} from "@config/TrainingEvent.ts";

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Builds a creature with a specified number of hidden neurons and
 * a realistic connection density.
 */
function buildCreature(
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

  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Generates synthetic training data with the specified number of samples.
 */
function generateTrainingData(
  inputCount: number,
  outputCount: number,
  sampleCount: number,
): Array<{ input: Float32Array; output: Float32Array }> {
  const data = [];
  for (let i = 0; i < sampleCount; i++) {
    const input = new Float32Array(inputCount);
    const output = new Float32Array(outputCount);
    for (let j = 0; j < inputCount; j++) {
      input[j] = Math.random();
    }
    // Simple binary classification based on mean of inputs
    const mean = input.reduce((a, b) => a + b, 0) / inputCount;
    for (let j = 0; j < outputCount; j++) {
      output[j] = mean > 0.5 ? 1 : 0;
    }
    data.push({ input, output });
  }
  return data;
}

/**
 * Formats a utilisation snapshot as a concise string.
 */
function formatSnapshot(snap: WorkerUtilisationSnapshot): string {
  return `fast=${snap.fastActive}/${snap.fastTotal} (${snap.fastUtilisationPct}%) ` +
    `heavy=${snap.heavyActive}/${snap.heavyTotal} (${snap.heavyUtilisationPct}%)`;
}

// ──────────────────────────────────────────────────────────────────
// Benchmark
// ──────────────────────────────────────────────────────────────────

Deno.bench({
  name:
    "WorkerUtilisationProfile — medium creature (30 neurons, 5 generations)",
  group: "worker-utilisation",
  baseline: true,
  fn: async () => {
    const INPUT_COUNT = 8;
    const OUTPUT_COUNT = 2;
    const HIDDEN_NEURONS = 30;
    const TRAINING_SAMPLES = 50;
    const GENERATIONS = 5;
    const POPULATION_SIZE = 20;

    const seed = buildCreature(INPUT_COUNT, OUTPUT_COUNT, HIDDEN_NEURONS);
    const trainingData = generateTrainingData(
      INPUT_COUNT,
      OUTPUT_COUNT,
      TRAINING_SAMPLES,
    );

    const events: GenerationCompleteEvent[] = [];

    await seed.evolveDataSet(trainingData, {
      mutation: Mutation.FFW,
      iterations: GENERATIONS,
      targetError: 0.0001,
      populationSize: POPULATION_SIZE,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    // Validate utilisation data was captured
    for (const event of events) {
      const wu = event.phaseTiming.workerUtilisation;
      if (!wu) {
        throw new Error("Missing workerUtilisation in generation event");
      }
      if (
        wu.overallCpuUtilisationPct === undefined ||
        wu.overallCpuUtilisationPct < 0 ||
        wu.overallCpuUtilisationPct > 100
      ) {
        throw new Error(
          `Invalid overallCpuUtilisationPct: ${wu.overallCpuUtilisationPct}`,
        );
      }
    }
  },
});

Deno.bench({
  name: "WorkerUtilisationProfile — large creature (80 neurons, 5 generations)",
  group: "worker-utilisation",
  fn: async () => {
    const INPUT_COUNT = 16;
    const OUTPUT_COUNT = 4;
    const HIDDEN_NEURONS = 80;
    const TRAINING_SAMPLES = 100;
    const GENERATIONS = 5;
    const POPULATION_SIZE = 30;

    const seed = buildCreature(INPUT_COUNT, OUTPUT_COUNT, HIDDEN_NEURONS);
    const trainingData = generateTrainingData(
      INPUT_COUNT,
      OUTPUT_COUNT,
      TRAINING_SAMPLES,
    );

    const events: GenerationCompleteEvent[] = [];

    await seed.evolveDataSet(trainingData, {
      mutation: Mutation.FFW,
      iterations: GENERATIONS,
      targetError: 0.0001,
      populationSize: POPULATION_SIZE,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    // Validate utilisation data was captured
    for (const event of events) {
      const wu = event.phaseTiming.workerUtilisation;
      if (!wu) {
        throw new Error("Missing workerUtilisation in generation event");
      }
    }
  },
});

// ──────────────────────────────────────────────────────────────────
// Standalone reporting (when run directly with `deno run`)
// ──────────────────────────────────────────────────────────────────

if (Deno.args.includes("--report")) {
  const INPUT_COUNT = 16;
  const OUTPUT_COUNT = 4;
  const HIDDEN_NEURONS = 50;
  const TRAINING_SAMPLES = 80;
  const GENERATIONS = 5;
  const POPULATION_SIZE = 25;

  console.log("\n=== Worker Utilisation Profile Report ===\n");
  console.log(
    `Configuration: ${HIDDEN_NEURONS} hidden neurons, ${TRAINING_SAMPLES} training samples`,
  );
  console.log(
    `Population: ${POPULATION_SIZE}, Generations: ${GENERATIONS}\n`,
  );

  const seed = buildCreature(INPUT_COUNT, OUTPUT_COUNT, HIDDEN_NEURONS);
  const trainingData = generateTrainingData(
    INPUT_COUNT,
    OUTPUT_COUNT,
    TRAINING_SAMPLES,
  );

  const events: GenerationCompleteEvent[] = [];

  await seed.evolveDataSet(trainingData, {
    mutation: Mutation.FFW,
    iterations: GENERATIONS,
    targetError: 0.0001,
    populationSize: POPULATION_SIZE,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  for (const event of events) {
    const pt = event.phaseTiming;
    const wu = pt.workerUtilisation as PhaseWorkerUtilisation;

    console.log(`--- Generation ${event.generation} ---`);
    console.log(`  Total: ${pt.totalMs}ms`);
    console.log(
      `  Fitness:       ${pt.fitnessMs}ms  ${
        wu.fitness ? formatSnapshot(wu.fitness) : "N/A"
      }`,
    );
    console.log(
      `  Sort:          ${pt.sortMs}ms  ${
        wu.sort ? formatSnapshot(wu.sort) : "N/A"
      }`,
    );
    console.log(
      `  WriteScores:   ${pt.writeScoresMs}ms  ${
        wu.writeScores ? formatSnapshot(wu.writeScores) : "N/A"
      }`,
    );
    console.log(
      `  Speciation:    ${pt.speciationMs}ms  ${
        wu.speciation ? formatSnapshot(wu.speciation) : "N/A"
      }`,
    );
    console.log(
      `  Breeding:      ${pt.breedingMs}ms  ${
        wu.breeding ? formatSnapshot(wu.breeding) : "N/A"
      }`,
    );
    console.log(
      `  Mutation:      ${pt.mutationMs}ms  ${
        wu.mutation ? formatSnapshot(wu.mutation) : "N/A"
      }`,
    );
    console.log(
      `  Deduplication: ${pt.deduplicationMs}ms  ${
        wu.deduplication ? formatSnapshot(wu.deduplication) : "N/A"
      }`,
    );
    if (pt.preWarmMs) {
      console.log(
        `  PreWarm:       ${pt.preWarmMs}ms  ${
          wu.preWarm ? formatSnapshot(wu.preWarm) : "N/A"
        }`,
      );
    }
    console.log(`  Overall CPU Utilisation: ${wu.overallCpuUtilisationPct}%`);
    console.log();
  }
}
