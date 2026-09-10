/**
 * Same-seed A/B for offspring pre-selection — Issue #3932.
 *
 * The acceptance criterion the issue is hardest about is the **diversity**
 * one: "a screen that improves mean fitness while collapsing diversity has
 * broken NEAT and will look like a success on the fitness trace." So the two
 * arms here run from the same seed and the same seed creature, and every
 * generation of both records the two numbers that would show that collapse —
 * the species count from a real {@link Genus} and the mean genetic distance
 * from the real {@link geneticCompatibility}.
 *
 * ## What is real and what is a stand-in
 *
 * Real: the creatures, the crossover ({@link Offspring.breed}), the mutation
 * operators ({@link Mutator}), speciation, genetic distance, and the
 * {@link PreSelection} stage with its screens. A stand-in only where the
 * production path cannot run in a script:
 *
 * - **The corpus** is a small deterministic regression, scored in-process by
 *   activating the creature, rather than the 21 GiB corpus a production run
 *   scores through the Rust scorer. Cost is therefore counted in **records
 *   scored**, which is what the real corpus charges for.
 * - **The cheap fidelity** of the `"sampled"` arm is the same arithmetic over
 *   a strided sub-sample — the Issue #3926 mechanism in miniature, not noise
 *   added to a true score.
 *
 * What that buys is a measurement of the **stage**: does over-generating and
 * screening buy a better endpoint per record scored, and does it cost
 * diversity? What it cannot tell you is how a 5,317-neuron GRQ creature
 * behaves.
 *
 * @module preSelectionAB
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Genus } from "@neat/Genus.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { computeSpeciesDiversity } from "@neat/SpeciesDiversity.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { PreSelection, type ScreenRank } from "@neat/PreSelection.ts";
import {
  type OffspringScreen,
  SampledCorpusScreen,
  SurrogateScreen,
} from "@neat/OffspringScreen.ts";
import {
  type PreSelectionScreenName,
  resolvePreSelectionConfig,
} from "@config/PreSelectionConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** One record of the synthetic corpus. */
export interface ABRecord {
  readonly input: Float32Array;
  readonly target: number;
}

/** How one A/B run is set up. Every field is explicit so a run is reproducible. */
export interface ABSettings {
  /** Seed for every random draw the run makes. */
  readonly seed: number;
  /** Records in the full corpus — the cost of one exact evaluation. */
  readonly corpusRecords: number;
  /** Creatures evaluated exactly per generation. */
  readonly populationSize: number;
  /** Generations to run. */
  readonly generations: number;
  /** Creatures carried into the next generation unchanged. */
  readonly elitism: number;
  /** Fraction of the corpus the `"sampled"` screen scores, in `(0, 1)`. */
  readonly cheapRate: number;
}

/** Sensible defaults; the harness overrides the arm's own knobs. */
export const DEFAULT_AB_SETTINGS: ABSettings = Object.freeze({
  seed: 3932,
  corpusRecords: 4_000,
  populationSize: 24,
  generations: 30,
  elitism: 2,
  cheapRate: 0.05,
});

/** One arm's configuration: how big a surplus, screened how. */
export interface ABArm {
  /** Label used in the report. */
  readonly arm: string;
  /** Offspring bred per population slot. */
  readonly ratio: number;
  /** Which screen ranks the surplus. */
  readonly screen: PreSelectionScreenName;
  /** Fraction of survivors drawn uniformly rather than by rank. */
  readonly randomSurvivorFraction?: number;
}

/** The control arm: today's behaviour exactly. */
export const CONTROL_ARM: ABArm = Object.freeze({
  arm: "control",
  ratio: 1,
  screen: "none" as PreSelectionScreenName,
});

/** What one generation of one arm looked like. */
export interface ABGeneration {
  readonly generation: number;
  /** Exact score of the best creature alive. Higher is better. */
  readonly bestScore: number;
  /** Species the population fell into — the primary diversity signal. */
  readonly speciesCount: number;
  /** Species count over population size, in `[0, 1]`. */
  readonly speciesDiversity: number;
  /** Mean pairwise genetic distance, in `[0, 1]`. */
  readonly meanGeneticDistance: number;
  /** Offspring the breeder produced. */
  readonly offspringGenerated: number;
  /** Offspring the screen discarded before anyone paid for them. */
  readonly screenedOut: number;
  /** Records scored by the end of this generation — the honest cost. */
  readonly recordsScored: number;
  /** Wall-clock the screen itself cost, in milliseconds. */
  readonly screenMs: number;
}

/** What one arm produced. */
export interface ABResult {
  readonly arm: string;
  readonly ratio: number;
  readonly screen: PreSelectionScreenName;
  /** Exact score of the creature the run would ship. Higher is better. */
  readonly finalScore: number;
  /** Exact evaluations paid for. */
  readonly exactEvaluations: number;
  /** Records scored in total, exact and cheap. */
  readonly recordsScored: number;
  /** Candidates the run considered — the number pre-selection raises. */
  readonly candidatesConsidered: number;
  /** Per-generation trace. */
  readonly generations: readonly ABGeneration[];
  /** Screen rank of every creature that went on to become an elite. */
  readonly eliteScreenRanks: readonly ScreenRank[];
}

/**
 * Build the corpus both arms score against.
 *
 * A smooth non-linear target with per-record noise: the noise is what makes a
 * sub-sample disagree with the full corpus, which is the phenomenon the
 * `"sampled"` screen is exposed to.
 *
 * @param settings - The run settings.
 * @returns The corpus, deterministic given the seed.
 */
export function buildCorpus(settings: ABSettings): ABRecord[] {
  const rng = createSeededRng(settings.seed);
  const records: ABRecord[] = [];
  for (let r = 0; r < settings.corpusRecords; r++) {
    const a = rng.random() * 2 - 1;
    const b = rng.random() * 2 - 1;
    const noise = (rng.random() - 0.5) * 0.05;
    records.push({
      input: new Float32Array([a, b]),
      target: 0.6 * Math.tanh(1.5 * a) - 0.35 * b * b + noise,
    });
  }
  return records;
}

/**
 * Mean squared error of a creature over a stride of the corpus, as a score.
 *
 * @param creature - The creature to score.
 * @param corpus - The corpus.
 * @param stride - `1` scores every record; `n` scores every nth.
 * @returns `-MSE`, so higher is better, and the records it cost.
 */
export function scoreCreature(
  creature: Creature,
  corpus: readonly ABRecord[],
  stride = 1,
): { score: number; records: number } {
  let sum = 0;
  let count = 0;
  for (let r = 0; r < corpus.length; r += stride) {
    const record = corpus[r];
    const output = creature.activate(record.input, false);
    const delta = output[0] - record.target;
    sum += delta * delta;
    count++;
  }
  if (count === 0) return { score: -Infinity, records: 0 };
  const mse = sum / count;
  return { score: Number.isFinite(mse) ? -mse : -Infinity, records: count };
}

/** Mean pairwise genetic distance over a population, in `[0, 1]`. */
export function meanGeneticDistance(population: readonly Creature[]): number {
  if (population.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < population.length; i++) {
    for (let j = i + 1; j < population.length; j++) {
      sum += 1 - geneticCompatibility(population[i], population[j]);
      pairs++;
    }
  }
  return sum / pairs;
}

/**
 * Run one arm of the A/B.
 *
 * @param arm - The arm's configuration.
 * @param settings - The shared run settings.
 * @param corpus - The corpus both arms score against.
 * @returns The arm's result. Async only because a screen may be: both of the
 *   screens used here are pure arithmetic.
 */
export async function runArm(
  arm: ABArm,
  settings: ABSettings,
  corpus: readonly ABRecord[],
): Promise<ABResult> {
  const rng = createSeededRng(settings.seed);
  // The crossover and the mutation operators draw from the *global* generator,
  // so seeding only the harness's own draws would leave the two arms running
  // different searches and the "same seed" in the report would be a lie.
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(settings.seed));
  try {
    return runSeededArm(arm, settings, corpus, rng);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

/** The body of {@link runArm}, with the global generator already seeded. */
async function runSeededArm(
  arm: ABArm,
  settings: ABSettings,
  corpus: readonly ABRecord[],
  rng: RandomNumberGenerator,
): Promise<ABResult> {
  const config = createNeatConfig({
    populationSize: settings.populationSize,
    elitism: settings.elitism,
    mutationRate: 0.5,
  });
  const mutator = new Mutator(config);
  const cheapStride = Math.max(2, Math.round(1 / settings.cheapRate));
  let recordsScored = 0;

  const screen = buildScreen(arm, settings, corpus, cheapStride, () => {
    recordsScored += Math.ceil(corpus.length / cheapStride);
  });
  const preSelection = new PreSelection(
    resolvePreSelectionConfig({
      ratio: arm.ratio,
      screen: arm.screen,
      ...(arm.randomSurvivorFraction === undefined
        ? {}
        : { randomSurvivorFraction: arm.randomSurvivorFraction }),
    }),
    screen,
  );

  let population = seedPopulation(settings, rng);
  const generations: ABGeneration[] = [];
  let exactEvaluations = 0;
  let candidatesConsidered = population.length;
  let bestScore = -Infinity;

  for (let generation = 1; generation <= settings.generations; generation++) {
    // 1. Exact evaluation — the cost this whole stage exists to spend better.
    for (const creature of population) {
      if (creature.score !== undefined) continue;
      const scored = scoreCreature(creature, corpus);
      creature.score = scored.score;
      recordsScored += scored.records;
      exactEvaluations++;
    }
    population.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    bestScore = population[0].score ?? -Infinity;

    // 2. Diversity, measured with the production functions.
    const genus = new Genus();
    for (const creature of population) {
      if (!Number.isFinite(creature.score)) continue;
      genus.addCreature(creature);
    }
    const speciesCount = genus.speciesMap.size;

    // 3. Teach the screen, then record where it ranked this generation's
    //    elites — the number that says whether the screen is worth having.
    preSelection.observe(population);
    const elitists = population.slice(0, settings.elitism);
    preSelection.recordElites(elitists);

    // 4. Breed the surplus the stage asks for, and screen it back.
    const slots = settings.populationSize - elitists.length;
    const target = preSelection.offspringTarget(slots);
    const offspring = breedOffspring(population, target, mutator, config, rng);
    candidatesConsidered += offspring.length;
    const screenStartMs = Date.now();
    const outcome = await preSelection.select(
      offspring,
      slots,
      generation,
      rng,
    );
    const screenMs = Date.now() - screenStartMs;

    generations.push({
      generation,
      bestScore,
      speciesCount,
      speciesDiversity: computeSpeciesDiversity(
        speciesCount,
        population.length,
      ),
      meanGeneticDistance: meanGeneticDistance(population),
      offspringGenerated: offspring.length,
      screenedOut: outcome.discarded.length,
      recordsScored,
      screenMs,
    });

    population = [...elitists, ...outcome.survivors];
  }

  return {
    arm: arm.arm,
    ratio: arm.ratio,
    screen: arm.screen,
    finalScore: bestScore,
    exactEvaluations,
    recordsScored,
    candidatesConsidered,
    generations,
    eliteScreenRanks: preSelection.eliteScreenRanks,
  };
}

/** Build the screen an arm asks for, charging the corpus for a cheap sweep. */
function buildScreen(
  arm: ABArm,
  settings: ABSettings,
  corpus: readonly ABRecord[],
  cheapStride: number,
  charge: () => void,
): OffspringScreen | undefined {
  if (arm.screen === "none") return undefined;
  if (arm.screen === "surrogate") {
    return new SurrogateScreen(settings.populationSize * 8, 5);
  }
  return new SampledCorpusScreen((candidates) => {
    const values = candidates.map((candidate) => {
      charge();
      return scoreCreature(candidate, corpus, cheapStride).score;
    });
    return Promise.resolve(values);
  });
}

/** `populationSize` structurally distinct creatures from one seed. */
function seedPopulation(
  settings: ABSettings,
  rng: RandomNumberGenerator,
): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < settings.populationSize; i++) {
    const creature = new Creature(2, 1, {
      layers: [{ count: 1 + (i % 3) }],
    });
    for (const neuron of creature.neurons) {
      if (neuron.type === "input") continue;
      neuron.bias = (rng.random() - 0.5) * 2;
    }
    for (const synapse of creature.synapses) {
      synapse.weight = (rng.random() - 0.5) * 2;
    }
    delete creature.uuid;
    CreatureUtil.makeUUID(creature);
    population.push(creature);
  }
  return population;
}

/** Breed `count` offspring from a score-sorted population, then mutate them. */
function breedOffspring(
  population: readonly Creature[],
  count: number,
  mutator: Mutator,
  config: ReturnType<typeof createNeatConfig>,
  rng: RandomNumberGenerator,
): Creature[] {
  const offspring: Creature[] = [];
  for (let i = 0; i < count; i++) {
    // Rank-biased draw: the square favours the fitter half without ever
    // excluding the tail, which is where novel topology comes from.
    const mum = population[
      Math.floor(rng.random() * rng.random() * population.length)
    ];
    const dad = population[
      Math.floor(rng.random() * rng.random() * population.length)
    ];
    const child = Offspring.breed(mum, dad, {
      geneticCompatibilityThreshold: config.geneticCompatibilityThreshold,
      interSpeciesCrossoverThreshold: config.interSpeciesCrossoverThreshold,
      forwardOnly: true,
    });
    if (child === undefined) continue;
    delete child.score;
    offspring.push(child);
  }
  mutator.mutate(offspring);
  for (const child of offspring) {
    delete child.score;
    if (child.uuid === undefined) CreatureUtil.makeUUID(child);
  }
  return offspring;
}
