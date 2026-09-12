/**
 * Stage 1 harness for the memetic local-search budget — Issue #3934.
 *
 * Runs a real memetic loop — real creatures, real crossover, real mutation
 * operators, and **real backpropagation** through `trainDir` — and records every
 * training event the way the production log does: the rank the selection rule
 * chose the creature at, the exact scores either side of the gradient step, and
 * the wall-clock the step cost.
 *
 * Two arms, same seed:
 *
 * - **`top`** — today's rule: the top `trainPerGen` creatures by current score
 *   (`selectTrainingCandidates`).
 * - **`random`** — the baseline the issue insists on: `trainPerGen` creatures
 *   drawn uniformly from the same finite-score population.
 *
 * The random arm is not only a baseline. It is also the **only** unbiased
 * estimator of rank-versus-gain available, because the top rule never observes a
 * gain at any rank past `trainPerGen - 1`.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, `Offspring.breed`, the {@link Mutator} operators, and the
 * gradient step itself (`trainDir` over a binary data directory, exactly as the
 * worker runs it). A stand-in only where the production path cannot run in a
 * script:
 *
 * - **The corpus** is a small deterministic regression written to a real data
 *   directory, not the 21.2 GiB production corpus. It is the same shape the
 *   trainer reads; it is not the same size.
 * - **The creatures** are small. A 5,317-neuron GRQ creature cannot be trained
 *   hundreds of times inside a script's budget, and the question being asked —
 *   does rank order gain — is about the *ordering*, not the magnitude.
 * - **The trainer** is whichever one the environment has. Production prefers the
 *   Rust `neat_ai_backpropagation` trainer and refuses to fall back when it is
 *   enabled but absent, which is the state of a plain checkout — so on one of
 *   those the harness needs `NEAT_AI_BACKPROP_ENABLED=0` and the TypeScript/WASM
 *   loop, and it says so rather than silently measuring nothing.
 *
 * @module memeticGainStudy
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  findRustTrainDirBinary,
  isRustTrainDirEnabled,
} from "@architecture/training/RustTrainDirBridge.ts";
import { findNativeBackpropLibrary } from "@architecture/training/NativeBackpropLibrary.ts";
import { Costs } from "@costs";
import { getLogger } from "@utils/Logger.ts";
import {
  countRankableCreatures,
  selectRankedTrainingCandidates,
} from "@neat/TrainingCandidates.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import type { GainObservation } from "./memeticGainAnalysis.ts";

/** Which rule allocates the local-search budget in an arm. */
export type SelectionPolicy = "top" | "random";

/** Both policies, in report order: today's rule first, its baseline second. */
export const SELECTION_POLICIES: readonly SelectionPolicy[] = Object.freeze([
  "top",
  "random",
]);

/** How one arm is set up. Every field is explicit so a run is reproducible. */
export interface StudySettings {
  /** Seed for every random draw the run makes. */
  readonly seed: number;
  /** Records in the corpus — the cost of one exact evaluation. */
  readonly corpusRecords: number;
  /** Creatures evaluated exactly per generation. */
  readonly populationSize: number;
  /** Generations to run. */
  readonly generations: number;
  /** Creatures carried into the next generation unchanged. */
  readonly elitism: number;
  /** Creatures given a gradient step per generation (`trainPerGen`). */
  readonly trainPerGen: number;
  /** Epochs each gradient step runs. */
  readonly trainingIterations: number;
}

/** Defaults sized so one arm produces ≥200 real training events. */
export const DEFAULT_STUDY_SETTINGS: StudySettings = Object.freeze({
  seed: 3934,
  corpusRecords: 600,
  populationSize: 20,
  generations: 25,
  elitism: 2,
  trainPerGen: 4,
  trainingIterations: 2,
});

/** One real training event. */
export interface StudyEvent extends GainObservation {
  /** Which rule selected the creature. */
  readonly policy: SelectionPolicy;
  /** Generation the step ran in. */
  readonly generation: number;
  /** Finite-score creatures the rank was taken over. */
  readonly rankedPopulation: number;
  /** Exact score carried into the step. */
  readonly scoreBefore: number;
  /** Exact score after the step; `undefined` when it produced none. */
  readonly scoreAfter: number | undefined;
  /** Whether the run kept the trained creature (it improved on its parent). */
  readonly kept: boolean;
}

/** What one arm produced. */
export interface ArmResult {
  readonly policy: SelectionPolicy;
  readonly seed: number;
  /** Exact score of the creature the run would ship. Higher is better. */
  readonly finalScore: number;
  /** Best exact score per generation. */
  readonly bestScorePerGeneration: readonly number[];
  /** Exact evaluations paid for, training re-scores included. */
  readonly exactEvaluations: number;
  /** Every training event, in dispatch order. */
  readonly events: readonly StudyEvent[];
}

/** One corpus record, in the shape both the scorer and the trainer read. */
interface StudyRecord extends DataRecordInterface {
  readonly input: Float32Array;
  readonly output: Float32Array;
}

/**
 * Build the corpus the arms score and train against.
 *
 * A smooth non-linear target with a little per-record noise — enough structure
 * for a gradient step to find, and enough noise that a step can fail to.
 *
 * @param settings - The run settings.
 * @returns The corpus, deterministic given the seed.
 */
export function buildStudyCorpus(settings: StudySettings): StudyRecord[] {
  const rng = createSeededRng(settings.seed);
  const records: StudyRecord[] = [];
  for (let r = 0; r < settings.corpusRecords; r++) {
    const a = rng.random() * 2 - 1;
    const b = rng.random() * 2 - 1;
    const noise = (rng.random() - 0.5) * 0.05;
    records.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([
        0.6 * Math.tanh(1.5 * a) - 0.35 * b * b + noise,
      ]),
    });
  }
  return records;
}

/**
 * Exact score of a creature over the whole corpus: `-MSE`, so higher is better.
 *
 * @param creature - The creature to score.
 * @param corpus - The corpus.
 * @returns The score; `-Infinity` when the creature produced no finite output.
 */
export function scoreExactly(
  creature: Creature,
  corpus: readonly StudyRecord[],
): number {
  let sum = 0;
  for (const record of corpus) {
    const output = creature.activate(record.input, false);
    const delta = output[0] - record.output[0];
    sum += delta * delta;
  }
  const mse = sum / corpus.length;
  return Number.isFinite(mse) ? -mse : Number.NEGATIVE_INFINITY;
}

/**
 * Pick this generation's training candidates under one policy.
 *
 * The `top` arm calls the production selector itself, so the arm under test is
 * the shipped rule rather than a restatement of it. The `random` arm draws
 * without replacement from the same finite-score creatures, and reports the rank
 * each draw *would* have been selected at — which is the column the correlation
 * needs.
 *
 * @param policy - The rule to apply.
 * @param sorted - The score-sorted population.
 * @param limit - Candidates to pick (`trainPerGen`).
 * @param rng - Seeded generator for the random arm.
 * @returns The candidates with their ranks, in selection order.
 */
export function selectUnderPolicy(
  policy: SelectionPolicy,
  sorted: readonly Creature[],
  limit: number,
  rng: RandomNumberGenerator,
): { creature: Creature; rank: number }[] {
  if (policy === "top") {
    return selectRankedTrainingCandidates([...sorted], limit);
  }
  // One definition of "rank", reused: asking the production selector for the
  // whole population gives every finite-score creature with the rank the rule
  // would have selected it at. Re-deriving that here is the drift the
  // `selectTrainingCandidates` delegation exists to prevent.
  const drawn: { creature: Creature; rank: number }[] = [];
  const pool = selectRankedTrainingCandidates([...sorted], sorted.length);
  while (drawn.length < limit && pool.length > 0) {
    const index = Math.floor(rng.random() * pool.length);
    drawn.push(pool[index]);
    pool.splice(index, 1);
  }
  return drawn;
}

/**
 * Run one arm: a real memetic loop under one selection policy.
 *
 * @param policy - Which rule allocates the local-search budget.
 * @param settings - The run settings.
 * @returns The arm's result.
 * @throws {Error} When the environment would make the gradient step a no-op.
 */
export function runMemeticArm(
  policy: SelectionPolicy,
  settings: StudySettings = DEFAULT_STUDY_SETTINGS,
): ArmResult {
  assertTrainerAvailable();
  // Crossover and the mutation operators draw from the *global* generator, so
  // seeding only the harness's own draws would leave the two arms running
  // different searches and the "same seed" in the report would be a lie.
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(settings.seed));
  try {
    return runSeededArm(policy, settings);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

/**
 * True when a trainer this checkout actually has will run the gradient step.
 *
 * `trainDir` prefers the Rust `neat_ai_backpropagation` trainer and **throws**
 * rather than falling back when it is enabled but its library and binary are
 * both absent — which is the state of a plain checkout. Saying so here, with the
 * fix, beats a stack trace from three frames down and a run of nothing but
 * failed events.
 *
 * Either trainer is fine: when the Rust one is present the study uses it, and
 * `./quality.sh --next` runs exactly that way.
 *
 * @returns True when `trainDir` will train rather than throw.
 */
export function isStudyTrainerAvailable(): boolean {
  if (!isRustTrainDirEnabled()) return true;
  return findNativeBackpropLibrary() !== null ||
    findRustTrainDirBinary() !== null;
}

/**
 * Refuse to run when the trainer would not actually train.
 *
 * @throws {Error} When Rust backpropagation is enabled but unavailable.
 */
function assertTrainerAvailable(): void {
  if (isStudyTrainerAvailable()) return;
  throw new Error(
    "memeticGainStudy cannot train: NEAT_AI_BACKPROP_ENABLED is on but " +
      "neither the neat_ai_backpropagation library nor its binary was found, " +
      "and trainDir refuses to fall back. Set NEAT_AI_BACKPROP_ENABLED=0 to " +
      "use the TypeScript/WASM loop, or build the Rust trainer.",
  );
}

/** The body of {@link runMemeticArm}, with the global generator seeded. */
function runSeededArm(
  policy: SelectionPolicy,
  settings: StudySettings,
): ArmResult {
  const rng = createSeededRng(settings.seed ^ 0x5eed);
  const config = createNeatConfig({
    populationSize: settings.populationSize,
    elitism: settings.elitism,
    mutationRate: 0.5,
  });
  const mutator = new Mutator(config);
  const corpus = buildStudyCorpus(settings);
  const cost = Costs.find("MSE");
  const dataDir = makeDataDir(corpus, corpus.length, { input: 2, output: 1 });

  try {
    let population = seedPopulation(settings, rng);
    const events: StudyEvent[] = [];
    const bestScorePerGeneration: number[] = [];
    let exactEvaluations = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (
      let generation = 1;
      generation <= settings.generations;
      generation++
    ) {
      for (const creature of population) {
        if (creature.score !== undefined) continue;
        creature.score = scoreExactly(creature, corpus);
        exactEvaluations++;
      }
      population.sort((a, b) =>
        (b.score ?? Number.NEGATIVE_INFINITY) -
        (a.score ?? Number.NEGATIVE_INFINITY)
      );
      const rankedPopulation = countRankableCreatures(population);

      for (
        const candidate of selectUnderPolicy(
          policy,
          population,
          settings.trainPerGen,
          rng,
        )
      ) {
        const event = trainOne(
          candidate.creature,
          candidate.rank,
          rankedPopulation,
          generation,
          policy,
          population,
          corpus,
          dataDir,
          cost,
          settings,
        );
        exactEvaluations++;
        events.push(event);
      }

      population.sort((a, b) =>
        (b.score ?? Number.NEGATIVE_INFINITY) -
        (a.score ?? Number.NEGATIVE_INFINITY)
      );
      bestScore = population[0].score ?? Number.NEGATIVE_INFINITY;
      bestScorePerGeneration.push(bestScore);

      const elitists = population.slice(0, settings.elitism);
      const offspring = breedOffspring(
        population,
        settings.populationSize - elitists.length,
        mutator,
        config,
        rng,
      );
      population = [...elitists, ...offspring];
    }

    return {
      policy,
      seed: settings.seed,
      finalScore: bestScore,
      bestScorePerGeneration,
      exactEvaluations,
      events,
    };
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
}

/**
 * Give one creature a real gradient step and measure what it bought.
 *
 * The step trains a **clone**, exactly as the worker does: the population's
 * creature is replaced only when the trained one scores better, which is the
 * production rollback (`isTrainingErrorRegression`) in miniature. Keeping a
 * worse creature would measure a rule nobody runs.
 *
 * @returns The event, whether or not the step improved anything.
 */
function trainOne(
  creature: Creature,
  rank: number,
  rankedPopulation: number,
  generation: number,
  policy: SelectionPolicy,
  population: Creature[],
  corpus: readonly StudyRecord[],
  dataDir: string,
  cost: ReturnType<typeof Costs.find>,
  settings: StudySettings,
): StudyEvent {
  const scoreBefore = creature.score ?? Number.NEGATIVE_INFINITY;
  const subject = Creature.fromJSON(creature.exportJSON());
  const startedMs = performance.now();
  let scoreAfter: number | undefined;
  let trained: Creature | undefined;
  try {
    const result = trainDir(subject, dataDir, {
      log: 0,
      iterations: settings.trainingIterations,
      targetError: 0,
      trainingSampleRate: 1,
      disableRandomSamples: true,
      trainingTimeOutMinutes: 1,
      feedbackLoop: false,
    }, cost);
    trained = result.compact === undefined
      ? subject
      : Creature.fromJSON(result.compact);
    scoreAfter = scoreExactly(trained, corpus);
  } catch (error) {
    // A step that threw still consumed its slot. Recorded as a failure rather
    // than dropped, so the policy is charged for what the run paid — and
    // announced through the repo's logger, not printed from a library module.
    getLogger().error(
      `[3934] gradient step failed at rank ${rank}, generation ${generation}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const wallClockMs = performance.now() - startedMs;

  let kept = false;
  if (
    trained !== undefined && scoreAfter !== undefined &&
    Number.isFinite(scoreAfter) && scoreAfter > scoreBefore
  ) {
    trained.score = scoreAfter;
    delete trained.uuid;
    CreatureUtil.makeUUID(trained);
    population[population.indexOf(creature)] = trained;
    kept = true;
  }

  return {
    policy,
    generation,
    rank,
    rankedPopulation,
    scoreBefore,
    scoreAfter,
    gain: scoreAfter === undefined ? undefined : scoreAfter - scoreBefore,
    wallClockMs,
    kept,
  };
}

/**
 * `populationSize` structurally distinct creatures from one seed.
 *
 * Every neuron UUID is **named**, not generated. `new Creature()` assigns fresh
 * random neuron UUIDs, and crossover aligns genes *by* those UUIDs — so a
 * generated seed population makes generation 1 of two same-seed runs breed
 * differently, and the "same seed" in the report would mean less than it says.
 * Naming them makes the starting point and the first generation reproducible;
 * the mutation operators still mint random UUIDs for the neurons they add, which
 * is the residual divergence the evidence document states plainly.
 *
 * @param settings - The run settings.
 * @param rng - Seeded generator for the weights and biases.
 * @returns The seed population.
 */
function seedPopulation(
  settings: StudySettings,
  rng: RandomNumberGenerator,
): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < settings.populationSize; i++) {
    const hiddenCount = 1 + (i % 3);
    const neurons: CreatureExport["neurons"] = [];
    const synapses: CreatureExport["synapses"] = [];
    for (let h = 0; h < hiddenCount; h++) {
      const uuid = `seed-${i}-hidden-${h}`;
      neurons.push({
        type: "hidden",
        uuid,
        squash: "TANH",
        bias: (rng.random() - 0.5) * 2,
      });
      synapses.push({
        fromUUID: "input-0",
        toUUID: uuid,
        weight: (rng.random() - 0.5) * 2,
      });
      synapses.push({
        fromUUID: "input-1",
        toUUID: uuid,
        weight: (rng.random() - 0.5) * 2,
      });
      synapses.push({
        fromUUID: uuid,
        toUUID: `seed-${i}-output-0`,
        weight: (rng.random() - 0.5) * 2,
      });
    }
    neurons.push({
      type: "output",
      uuid: `seed-${i}-output-0`,
      squash: "IDENTITY",
      bias: (rng.random() - 0.5) * 2,
    });
    const creature = Creature.fromJSON({
      neurons,
      synapses,
      input: 2,
      output: 1,
      forwardOnly: true,
    });
    CreatureUtil.makeUUID(creature);
    population.push(creature);
  }
  return population;
}

/**
 * Breed `count` offspring from a score-sorted population, then mutate them.
 *
 * The population is always refilled to `count`. A crossover that declines —
 * `Offspring.breed` returns `undefined` for parents it cannot combine, which
 * becomes the common case once a lineage converges — is retried with a fresh
 * pair, and any remainder is filled with mutated clones. Without that the
 * population shrinks every generation and collapses to the elites within five
 * generations, which would measure rank-versus-gain over a population of two.
 *
 * @param population - The score-sorted parents.
 * @param count - Offspring slots to fill.
 * @param mutator - The production mutation operators.
 * @param config - Resolved config, for the compatibility thresholds.
 * @param rng - Seeded generator.
 * @returns Exactly `count` offspring, unless the population was empty.
 */
function breedOffspring(
  population: readonly Creature[],
  count: number,
  mutator: Mutator,
  config: ReturnType<typeof createNeatConfig>,
  rng: RandomNumberGenerator,
): Creature[] {
  const offspring: Creature[] = [];
  if (population.length === 0 || count <= 0) return offspring;

  // Rank-biased draw: the square favours the fitter half without ever
  // excluding the tail, which is where novel topology comes from.
  const draw = () =>
    population[Math.floor(rng.random() * rng.random() * population.length)];

  const maxAttempts = count * 8;
  let attempts = 0;
  while (offspring.length < count && attempts < maxAttempts) {
    attempts++;
    const mum = draw();
    const dad = draw();
    if (mum === dad) continue;
    const child = Offspring.breed(mum, dad, {
      geneticCompatibilityThreshold: config.geneticCompatibilityThreshold,
      interSpeciesCrossoverThreshold: config.interSpeciesCrossoverThreshold,
      forwardOnly: true,
    });
    if (child === undefined) continue;
    delete child.score;
    offspring.push(child);
  }
  while (offspring.length < count) {
    // Crossover could not fill the slot, so the slot is filled the other way
    // evolution fills one: a clone the mutator below will diverge.
    const clone = Creature.fromJSON(draw().exportJSON());
    delete clone.score;
    delete clone.uuid;
    offspring.push(clone);
  }

  mutator.mutate(offspring);
  for (const child of offspring) {
    delete child.score;
    if (child.uuid === undefined) CreatureUtil.makeUUID(child);
  }
  return offspring;
}
