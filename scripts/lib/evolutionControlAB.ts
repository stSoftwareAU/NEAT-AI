/**
 * Same-seed A/B for the evolution-control strategies — Issue #3931.
 *
 * The acceptance criterion the issue is hardest about is this one: a same-seed
 * A/B over at least 50 generations, control against each strategy, judged on
 * the **exact score of the final creature** rather than on generations
 * completed. "More generations at a worse endpoint is a regression, and it is
 * the specific regression this whole sweep risks."
 *
 * ## Why this is a simulation, and what that costs
 *
 * The A/B needs a cheap evaluator to switch to, and after the rest of the sweep
 * landed there is not one that production may use:
 *
 * - [Issue #3927](../../docs/evidence/rank-fidelity-3927.md) measured the
 *   sampled corpus and found **no rate safe** on the real lineage.
 * - [Issue #3930](../../docs/evidence/surrogate-feasibility-3930.md) could not
 *   decide its surrogate kill gate; Stage 2 was never built.
 *
 * So the objective here is a small deterministic regression whose exact fitness
 * is the mean squared error over a whole corpus, and whose **cheap** fitness is
 * the same arithmetic over a strided sub-sample of that corpus — the Issue
 * #3926 mechanism in miniature, not noise added to a true score. The policy
 * driving it is the real {@link EvolutionControl}, not a stand-in.
 *
 * What that buys is a measurement of the **policy**: does exact re-anchoring
 * hold the endpoint while cheap generations buy search, and does the canary see
 * drift before it costs anything? What it cannot tell you is how a 5,317-neuron
 * GRQ creature behaves. The evidence file says so in the same words.
 *
 * Cost is counted in **records scored**, which is what the 21 GiB corpus
 * actually charges for: an exact evaluation costs the whole corpus, a cheap one
 * costs its sampled fraction.
 *
 * @module evolutionControlAB
 */

import {
  createSeededRng,
  type RandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { EvolutionControl } from "@neat/EvolutionControl.ts";
import {
  type EvolutionControlConfig,
  resolveEvolutionControlConfig,
} from "@config/EvolutionControlConfig.ts";

/** One record of the synthetic corpus: inputs and the value to predict. */
export interface ABRecord {
  readonly inputs: readonly number[];
  readonly target: number;
}

/** A candidate solution — the weights of a linear model. */
export type ABGenome = readonly number[];

/** How the A/B is set up. Every field is explicit so a run is reproducible. */
export interface ABSettings {
  /** Seed for every random draw the run makes. */
  readonly seed: number;
  /** Records in the full corpus — the cost of one exact evaluation. */
  readonly corpusRecords: number;
  /** Weights per genome. */
  readonly genomeLength: number;
  /** Creatures per generation. */
  readonly populationSize: number;
  /** Generations to run. The issue requires at least 50. */
  readonly generations: number;
  /** Fraction of the corpus a cheap evaluation scores, in `(0, 1)`. */
  readonly cheapRate: number;
  /** Standard deviation of the Gaussian mutation applied to each weight. */
  readonly mutationSigma: number;
  /** Creatures carried into the next generation unchanged. */
  readonly elitism: number;
}

/** Sensible defaults; the harness overrides `strategy` per arm. */
export const DEFAULT_AB_SETTINGS: ABSettings = Object.freeze({
  seed: 3931,
  corpusRecords: 20_000,
  genomeLength: 12,
  populationSize: 24,
  generations: 60,
  cheapRate: 0.05,
  mutationSigma: 0.35,
  elitism: 2,
});

/** What one arm of the A/B produced. */
export interface ABResult {
  /** The arm's label — `"none"`, `"generation"`, `"individual"`. */
  readonly arm: string;
  /** Exact score of the creature the run would ship. Higher is better. */
  readonly finalExactScore: number;
  /** Generations run. */
  readonly generations: number;
  /** Exact evaluations paid for. */
  readonly exactEvaluations: number;
  /** Cheap evaluations paid for. */
  readonly approximateEvaluations: number;
  /** Records scored in total — the honest cost of the arm. */
  readonly recordsScored: number;
  /** Canary divergence at each exact anchor, oldest first. */
  readonly canaryDivergences: readonly number[];
  /** The generation the canary abandoned the cheap path, or `null`. */
  readonly escalatedGeneration: number | null;
  /**
   * Exact score of the incumbent at each generation, oldest first — the trace
   * the equal-budget comparison is read from.
   */
  readonly incumbentTrace: readonly number[];
  /** Records scored by the end of each generation, oldest first. */
  readonly recordsTrace: readonly number[];
}

/**
 * Build the corpus the whole A/B scores against.
 *
 * A linear ground truth with per-record noise: the noise is what makes a
 * sub-sample disagree with the full corpus, which is the entire phenomenon
 * under test. Deterministic given the seed.
 *
 * @param settings - The run settings.
 * @returns The corpus, and the weights it was generated from.
 */
export function buildCorpus(
  settings: ABSettings,
): { records: ABRecord[]; truth: number[] } {
  const rng = createSeededRng(settings.seed);
  const truth: number[] = [];
  for (let i = 0; i < settings.genomeLength; i++) {
    truth.push(gaussian(rng));
  }
  const records: ABRecord[] = [];
  for (let r = 0; r < settings.corpusRecords; r++) {
    const inputs: number[] = [];
    let target = 0;
    for (let i = 0; i < settings.genomeLength; i++) {
      const value = gaussian(rng);
      inputs.push(value);
      target += value * truth[i];
    }
    records.push({ inputs, target: target + gaussian(rng) * 2 });
  }
  return { records, truth };
}

/**
 * Score a genome over a strided slice of the corpus.
 *
 * The stride — rather than a random draw — is exactly how NEAT-AI-Refinery
 * publishes a sampled corpus (Issue #3926), so the cheap score here has the
 * same character as the cheap score production would get.
 *
 * @param genome - The weights to score.
 * @param records - The full corpus.
 * @param stride - Score every `stride`th record; `1` is the exact evaluation.
 * @param phase - Which residue of the stride to score, for a different slice.
 * @returns The negated mean squared error — higher is fitter, as everywhere
 *   else in NEAT-AI.
 */
export function scoreGenome(
  genome: ABGenome,
  records: readonly ABRecord[],
  stride: number,
  phase = 0,
): number {
  let sum = 0;
  let count = 0;
  for (let r = phase; r < records.length; r += stride) {
    const record = records[r];
    let prediction = 0;
    for (let i = 0; i < genome.length; i++) {
      prediction += genome[i] * record.inputs[i];
    }
    const residual = prediction - record.target;
    sum += residual * residual;
    count++;
  }
  if (count === 0) {
    throw new Error(
      `scoreGenome scored no records: stride ${stride}, phase ${phase}, ` +
        `${records.length} records`,
    );
  }
  return -(sum / count);
}

/**
 * Run one arm of the A/B.
 *
 * Every arm starts from the same seeded population and mutates with the same
 * seeded draws, so the only difference between arms is the fidelity policy.
 *
 * The **elite guarantee** is structural here rather than asserted: the
 * incumbent — the genome the arm would ship — is only ever replaced by one
 * holding an exact score, so it can never be selected on an approximation.
 * (`EvolutionControl.assertExact` enforces the same rule on real creatures in
 * the evolution loop; these genomes are not creatures and carry no tags.)
 *
 * @param arm - Label for the result.
 * @param strategyConfig - The evolution-control configuration for this arm.
 * @param records - The corpus, shared across arms.
 * @param settings - The run settings, shared across arms.
 * @returns What the arm produced.
 */
export function runArm(
  arm: string,
  strategyConfig: EvolutionControlConfig,
  records: readonly ABRecord[],
  settings: ABSettings,
): ABResult {
  const control = new EvolutionControl(
    resolveEvolutionControlConfig(strategyConfig),
  );
  const rng = createSeededRng(settings.seed + 1);
  const cheapStride = Math.max(2, Math.round(1 / settings.cheapRate));
  const cheapRecords = Math.ceil(records.length / cheapStride);

  let population: ABGenome[] = [];
  for (let i = 0; i < settings.populationSize; i++) {
    const genome: number[] = [];
    for (let g = 0; g < settings.genomeLength; g++) genome.push(gaussian(rng));
    population.push(genome);
  }

  let incumbent: ABGenome = population[0];
  let incumbentScore = -Infinity;
  let exactEvaluations = 0;
  let approximateEvaluations = 0;
  let recordsScored = 0;
  const canaryDivergences: number[] = [];
  const incumbentTrace: number[] = [];
  const recordsTrace: number[] = [];

  for (let generation = 1; generation <= settings.generations; generation++) {
    const plan = control.beginGeneration(generation);

    // Score the sweep at the planned fidelity.
    const sweepExact = plan.exactSweep;
    const cheapScores: number[] = [];
    const scores: number[] = [];
    for (const genome of population) {
      if (sweepExact) {
        const score = scoreGenome(genome, records, 1);
        scores.push(score);
        cheapScores.push(score);
        exactEvaluations++;
        recordsScored += records.length;
      } else {
        // A different phase each generation, so a cheap arm is not repeatedly
        // fooled by the same slice — the phase spread Issue #3927 measured.
        const score = scoreGenome(
          genome,
          records,
          cheapStride,
          generation % cheapStride,
        );
        scores.push(score);
        cheapScores.push(score);
        approximateEvaluations++;
        recordsScored += cheapRecords;
      }
    }

    // Individual-based control: the top-k plus a spread are re-evaluated
    // exactly on top of the cheap sweep.
    const exactScores = new Map<number, number>();
    if (!sweepExact && plan.strategy === "individual") {
      for (const index of exactSubsetIndices(control, scores)) {
        const score = scoreGenome(population[index], records, 1);
        exactScores.set(index, score);
        exactEvaluations++;
        recordsScored += records.length;
      }
    } else if (sweepExact) {
      scores.forEach((score, index) => exactScores.set(index, score));
    }

    // The canary. `"none"` never approximates anything, so there is no cheap
    // ordering to compare and no reading is taken — an arm that cannot drift
    // must not report a divergence of zero, which would read as evidence.
    if (control.active) {
      let approximateOrder: number[];
      let exactOrder: number[];
      if (sweepExact) {
        // An exact sweep re-anchors. What the cheap evaluator *would* have
        // said about this same population is the drift measurement, and it
        // costs one sampled pass — charged for, like every other evaluation.
        approximateOrder = population.map((genome) => {
          recordsScored += cheapRecords;
          approximateEvaluations++;
          return scoreGenome(
            genome,
            records,
            cheapStride,
            generation % cheapStride,
          );
        });
        exactOrder = [...scores];
      } else {
        const indices = [...exactScores.keys()];
        approximateOrder = indices.map((i) => cheapScores[i]);
        exactOrder = indices.map((i) => exactScores.get(i)!);
      }
      if (approximateOrder.length >= 2) {
        const reading = control.recordExactSweep(
          generation,
          approximateOrder,
          exactOrder,
        );
        if (reading.divergence !== null) {
          canaryDivergences.push(reading.divergence);
        }
      }
    }

    // The incumbent moves only on an exact score. This is the elite guarantee.
    for (const [index, score] of exactScores) {
      if (score > incumbentScore) {
        incumbentScore = score;
        incumbent = population[index];
      }
    }
    incumbentTrace.push(incumbentScore);
    recordsTrace.push(recordsScored);

    population = breed(population, scores, incumbent, rng, settings);
  }

  return {
    arm,
    finalExactScore: scoreGenome(incumbent, records, 1),
    generations: settings.generations,
    exactEvaluations,
    approximateEvaluations,
    recordsScored,
    canaryDivergences,
    escalatedGeneration: control.escalatedGeneration ?? null,
    incumbentTrace,
    recordsTrace,
  };
}

/**
 * Which indices individual-based control picks for exact re-evaluation.
 *
 * Delegates the *choice* to {@link EvolutionControl.selectExactCandidates} so
 * the harness measures the shipped policy rather than a copy of it.
 *
 * @param control - The policy under test.
 * @param scores - This generation's cheap scores, in population order.
 * @returns The population indices to evaluate exactly.
 */
export function exactSubsetIndices(
  control: EvolutionControl,
  scores: readonly number[],
): number[] {
  const stand = scores.map((score, index) => ({ score, index }));
  return control.selectExactCandidates(stand).map((entry) => entry.index);
}

/**
 * The exact score each arm had reached by the time it had scored `budget`
 * records — the equal-cost comparison, as opposed to the equal-generation one.
 *
 * @param result - An arm's result.
 * @param budget - The record budget to read the trace at.
 * @returns The incumbent's exact score at that budget, or `null` when the arm
 *   had not yet produced an exact score by then.
 */
export function scoreAtBudget(
  result: ABResult,
  budget: number,
): number | null {
  let best: number | null = null;
  for (let g = 0; g < result.recordsTrace.length; g++) {
    if (result.recordsTrace[g] > budget) break;
    const score = result.incumbentTrace[g];
    if (Number.isFinite(score)) best = score;
  }
  return best;
}

/** Truncation selection with elitism, then Gaussian mutation. */
function breed(
  population: readonly ABGenome[],
  scores: readonly number[],
  incumbent: ABGenome,
  rng: RandomNumberGenerator,
  settings: ABSettings,
): ABGenome[] {
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score);
  const parents = ranked
    .slice(0, Math.max(2, Math.floor(settings.populationSize / 4)))
    .map((entry) => population[entry.index]);

  // The incumbent is always carried forward: it is the only genome the run is
  // entitled to ship, and it holds an exact score by construction.
  const next: ABGenome[] = [incumbent];
  for (let i = 1; i < settings.elitism; i++) {
    next.push(population[ranked[i - 1].index]);
  }
  while (next.length < settings.populationSize) {
    const parent = parents[rng.randomInt(0, parents.length - 1)];
    const child = parent.map((weight) =>
      weight + gaussian(rng) * settings.mutationSigma
    );
    next.push(child);
  }
  return next;
}

/** Box–Muller standard normal from the seeded uniform generator. */
function gaussian(rng: RandomNumberGenerator): number {
  const u = Math.max(rng.random(), Number.EPSILON);
  const v = rng.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
