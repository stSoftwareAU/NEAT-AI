/**
 * The cheap screens offspring pre-selection ranks a surplus with — Issue #3932.
 *
 * A screen answers one question: *of these candidates, which are worth
 * measuring?* It never answers *how good is this creature*. That distinction is
 * the whole reason pre-selection tolerates an evaluator no fitness policy
 * could use — a screen that is right 70 % of the time still improves the
 * expected quality of the exactly-evaluated set, while a **fitness** that is
 * right 70 % of the time corrupts selection outright.
 *
 * ```mermaid
 * flowchart LR
 *   B[surplus offspring] --> S{screen}
 *   S -->|sampled| C["caller-supplied cheap evaluator<br/>(Issue #3926 corpus)"]
 *   S -->|surrogate| K["k-NN over the structural descriptor,<br/>fitted to exact scores already paid for"]
 *   C --> V[one value per candidate<br/>higher is better]
 *   K --> V
 *   V --> P[PreSelection: survivors + discards]
 * ```
 *
 * Two rules bind every implementation:
 *
 * - **A screen value is never a score.** No implementation writes
 *   `Creature.score`, and {@link PreSelection} verifies that it did not.
 * - **A screen that cannot rank says so** through {@link OffspringScreen.ready}
 *   rather than returning a plausible constant. An unready screen makes the
 *   stage breed no surplus at all, so nothing is discarded on a number that
 *   means nothing.
 *
 * @module OffspringScreen
 */

import type { Creature } from "@creature";
import { computeEvaluationDescriptor } from "@archive/EvaluationDescriptor.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import type {
  PreSelectionScreenName,
  RequiredPreSelectionConfig,
} from "@config/PreSelectionConfig.ts";

/**
 * A cheap ranking of candidate offspring.
 *
 * Implementations are consulted between breeding and fitness, so a screen that
 * costs a meaningful fraction of an exact evaluation has defeated the purpose;
 * {@link PreSelection} times every call and reports it.
 */
export interface OffspringScreen {
  /** Which configured screen this is. */
  readonly name: PreSelectionScreenName;
  /**
   * False while the screen has too little information to rank anything — a
   * surrogate before the first generation's exact scores have arrived, say.
   */
  ready(): boolean;
  /**
   * Rank the candidates.
   *
   * @param candidates - The surplus offspring, unscored.
   * @returns One value per candidate, in the same order, **higher is better**.
   */
  screen(candidates: readonly Creature[]): Promise<readonly number[]>;
  /**
   * Feed an exact score back to a screen that learns from them.
   *
   * @param creature - A creature that has just taken a full-corpus score.
   * @param score - That score.
   */
  observe?(creature: Creature, score: number): void;
}

/** The cheap evaluator a {@link SampledCorpusScreen} is built around. */
export type SampledEvaluator = (
  candidates: readonly Creature[],
) => Promise<readonly number[]>;

/**
 * The `"sampled"` screen: a low-rate cheap evaluation of every candidate.
 *
 * Issue #3926 put the cheap fidelity in the **data pipeline** — a run is
 * pointed at a sampled corpus — so the evolution loop has no second, cheaper
 * evaluator to call. This class is therefore built around an evaluator the
 * caller supplies, which is how the A/B harness and any consumer that does
 * publish a sampled corpus can use it. Constructing one without an evaluator
 * is refused: a screen that returns a fabricated number still discards two
 * thirds of a generation's offspring.
 */
export class SampledCorpusScreen implements OffspringScreen {
  readonly name: PreSelectionScreenName = "sampled";
  private readonly evaluate: SampledEvaluator;

  /**
   * @param evaluate - Scores the candidates cheaply; higher is better.
   * @throws {PreSelectionError} `NO_SCREEN_EVALUATOR` when none is supplied.
   */
  constructor(evaluate: SampledEvaluator | undefined) {
    if (typeof evaluate !== "function") {
      throw new PreSelectionError(
        `the "sampled" screen needs a cheap evaluator and none was supplied: ` +
          `Issue #3926 publishes the sampled corpus through the data ` +
          `pipeline, so nothing in the evolution loop scores one. Supply an ` +
          `evaluator, or use the "surrogate" screen.`,
        "NO_SCREEN_EVALUATOR",
      );
    }
    this.evaluate = evaluate;
  }

  /** Always ready — the evaluator needs no history. */
  ready(): boolean {
    return true;
  }

  /**
   * Score every candidate with the cheap evaluator.
   *
   * @param candidates - The surplus offspring.
   * @returns One cheap value per candidate, higher is better.
   * @throws {PreSelectionError} `INVALID_SCREEN_VALUE` when the evaluator
   *   returns the wrong number of values, or one that is not finite.
   */
  async screen(candidates: readonly Creature[]): Promise<readonly number[]> {
    const values = await this.evaluate(candidates);
    assertScreenValues(this.name, candidates.length, values);
    return values;
  }
}

/** One `(descriptor, exact score)` pair the surrogate is fitted to. */
interface TrainingPoint {
  readonly features: readonly number[];
  readonly score: number;
  /** Identity of the creature it came from, when it had one. */
  readonly uuid?: string;
}

/**
 * The `"surrogate"` screen: predict a candidate's score from its structure.
 *
 * Distance-weighted **k-nearest-neighbours** over the standardised structural
 * descriptor of Issue #3929, fitted to the exact scores the run has already
 * paid for. k-NN is chosen over the regression families surveyed in Issue
 * #3930 for one reason: it has no fit to go singular. A design matrix that
 * cannot be inverted, a kernel width that collapses, or a ridge that swamps
 * the signal are all failures that return a *number*, and a screen returning
 * confident nonsense is exactly what this stage cannot detect on its own.
 *
 * **Its predictive value is unproven.** Issue #3930's feasibility gate on
 * 5,300-neuron GRQ creatures was undecidable, and nothing here changes that.
 * What makes it usable anyway is the consumer: pre-selection only orders
 * candidates, and {@link PreSelection} reports the screen rank of every
 * creature that goes on to become an elite, so a screen anti-correlated with
 * what matters shows up in the trace instead of hiding in it.
 */
export class SurrogateScreen implements OffspringScreen {
  readonly name: PreSelectionScreenName = "surrogate";
  private readonly window: number;
  private readonly neighbours: number;
  /** Most recent `window` training points; oldest evicted first. */
  private points: TrainingPoint[] = [];
  private readonly seen = new Set<string>();

  /**
   * @param window - Training points retained. Must be `>= 3`.
   * @param neighbours - Neighbours a prediction averages. Must be `>= 1`.
   */
  constructor(window: number, neighbours: number) {
    this.window = window;
    this.neighbours = neighbours;
  }

  /** Training points the model currently holds. */
  get trainingSize(): number {
    return this.points.length;
  }

  /** True once enough exact scores have arrived to rank anything. */
  ready(): boolean {
    return this.points.length >= MIN_TRAINING_POINTS;
  }

  /**
   * Record an exact score for the model to learn from.
   *
   * A creature already in the window is skipped rather than duplicated — an
   * elite survives many generations, and letting it re-enter every generation
   * would let one creature crowd out the window it is meant to summarise.
   * A non-finite score (a creature that took `-Infinity` for a WASM panic)
   * describes the runtime, not the design point, and is never learnt from.
   *
   * @param creature - The creature that was scored exactly.
   * @param score - Its full-corpus score.
   */
  observe(creature: Creature, score: number): void {
    if (!Number.isFinite(score)) return;
    const uuid = creature.uuid;
    if (uuid !== undefined && this.seen.has(uuid)) return;
    const features = computeEvaluationDescriptor(creature);
    for (const value of features) {
      if (!Number.isFinite(value)) return;
    }
    if (uuid !== undefined) this.seen.add(uuid);
    this.points.push(
      uuid === undefined ? { features, score } : {
        features,
        score,
        uuid,
      },
    );
    while (this.points.length > this.window) {
      const evicted = this.points.shift();
      // The guard tracks the window, not the run: an evicted creature becomes
      // learnable again rather than being excluded for the rest of the run.
      if (evicted?.uuid !== undefined) this.seen.delete(evicted.uuid);
    }
  }

  /**
   * Predict a score for every candidate.
   *
   * @param candidates - The surplus offspring.
   * @returns One predicted score per candidate, higher is better.
   * @throws {PreSelectionError} `INVALID_SCREEN_VALUE` when the model is not
   *   ready, or a candidate's descriptor is not finite.
   */
  // deno-lint-ignore require-await
  async screen(candidates: readonly Creature[]): Promise<readonly number[]> {
    if (!this.ready()) {
      throw new PreSelectionError(
        `the "surrogate" screen was asked to rank ${candidates.length} ` +
          `candidate(s) with ${this.points.length} training point(s); it ` +
          `needs at least ${MIN_TRAINING_POINTS} and reports that through ` +
          `ready()`,
        "INVALID_SCREEN_VALUE",
      );
    }
    const scaler = fitScaler(this.points);
    const scaled = this.points.map((point) => ({
      features: applyScaler(scaler, point.features),
      score: point.score,
    }));
    const values = candidates.map((candidate) => {
      const features = computeEvaluationDescriptor(candidate);
      for (const value of features) {
        if (!Number.isFinite(value)) {
          throw new PreSelectionError(
            `candidate ${
              candidate.uuid?.substring(0, 8) ?? "<no uuid>"
            } has a non-finite descriptor slot; a surrogate fitted to it would ` +
              `rank on nonsense`,
            "INVALID_SCREEN_VALUE",
          );
        }
      }
      return predict(scaled, applyScaler(scaler, features), this.neighbours);
    });
    assertScreenValues(this.name, candidates.length, values);
    return values;
  }

  /** Drop everything learnt. Call when starting a new run. */
  reset(): void {
    this.points = [];
    this.seen.clear();
  }
}

/** Fewest training points any prediction here may be made from. */
export const MIN_TRAINING_POINTS = 3;

/**
 * Build the screen a resolved configuration asks for.
 *
 * @param config - The resolved pre-selection configuration.
 * @param sampledEvaluator - The cheap evaluator the `"sampled"` screen needs.
 * @returns The screen, or `undefined` when the configuration names none.
 * @throws {PreSelectionError} `NO_SCREEN_EVALUATOR` when `"sampled"` is asked
 *   for and no evaluator is available.
 */
export function createOffspringScreen(
  config: RequiredPreSelectionConfig,
  sampledEvaluator?: SampledEvaluator,
): OffspringScreen | undefined {
  switch (config.screen) {
    case "none":
      return undefined;
    case "sampled":
      return new SampledCorpusScreen(sampledEvaluator);
    case "surrogate":
      return new SurrogateScreen(
        config.surrogateWindow,
        config.surrogateNeighbours,
      );
  }
}

/** Column means and standard deviations of the informative columns. */
interface FeatureScaler {
  readonly keep: readonly number[];
  readonly mean: readonly number[];
  readonly sd: readonly number[];
}

/**
 * Standardise the training columns, dropping the ones that carry no signal.
 *
 * A descriptor slot that is constant across the window — every creature in a
 * run has the same input count — has no variance to divide by, so it is
 * dropped rather than turned into an infinity.
 */
function fitScaler(points: readonly TrainingPoint[]): FeatureScaler {
  const width = points[0].features.length;
  const keep: number[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  for (let column = 0; column < width; column++) {
    let sum = 0;
    for (const point of points) sum += point.features[column];
    const columnMean = sum / points.length;
    let variance = 0;
    for (const point of points) {
      const delta = point.features[column] - columnMean;
      variance += delta * delta;
    }
    const columnSd = Math.sqrt(variance / points.length);
    if (columnSd <= 0) continue;
    keep.push(column);
    mean.push(columnMean);
    sd.push(columnSd);
  }
  return { keep, mean, sd };
}

/** Project a raw feature vector into the scaler's kept, standardised space. */
function applyScaler(
  scaler: FeatureScaler,
  features: readonly number[],
): number[] {
  const scaled = new Array<number>(scaler.keep.length);
  for (let i = 0; i < scaler.keep.length; i++) {
    scaled[i] = (features[scaler.keep[i]] - scaler.mean[i]) / scaler.sd[i];
  }
  return scaled;
}

/**
 * Distance-weighted mean of the `k` nearest training scores.
 *
 * With every informative column dropped — a window in which the creatures are
 * structurally identical — every distance is zero and the prediction is the
 * window mean, which is the honest answer: the descriptor cannot tell these
 * candidates apart, so the screen does not pretend to either.
 */
function predict(
  points: readonly TrainingPoint[],
  query: readonly number[],
  neighbours: number,
): number {
  const distances = points.map((point) => ({
    distance: euclidean(point.features, query),
    score: point.score,
  }));
  distances.sort((a, b) => a.distance - b.distance);
  const k = Math.min(neighbours, distances.length);
  let weighted = 0;
  let weight = 0;
  for (let i = 0; i < k; i++) {
    const { distance, score } = distances[i];
    // An exact structural match is the strongest evidence available: take its
    // score rather than diluting it with the neighbours behind it.
    if (distance === 0) return score;
    const w = 1 / distance;
    weighted += w * score;
    weight += w;
  }
  return weighted / weight;
}

/** Euclidean distance between two vectors of the same length. */
function euclidean(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

/** Refuse a screen result that cannot rank the candidates it was given. */
function assertScreenValues(
  name: PreSelectionScreenName,
  expected: number,
  values: readonly number[],
): void {
  if (values.length !== expected) {
    throw new PreSelectionError(
      `the ${JSON.stringify(name)} screen returned ${values.length} value(s) ` +
        `for ${expected} candidate(s); a ranking taken over misaligned ` +
        `values discards the wrong creatures`,
      "INVALID_SCREEN_VALUE",
    );
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new PreSelectionError(
        `the ${JSON.stringify(name)} screen returned ${values[i]} for ` +
          `candidate ${i}; a non-finite screen value cannot order anything`,
        "INVALID_SCREEN_VALUE",
      );
    }
  }
}
