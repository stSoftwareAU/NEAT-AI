/**
 * What the cheap problems are used to measure — Issue #3935.
 *
 * Three studies, each impossible on the GRQ corpus and trivial here because
 * the design space of a {@link CheapProblem} can be enumerated:
 *
 * 1. {@link measureSurrogateAccuracy} — fit a surrogate family to a sample and
 *    score it against the **whole** lattice, so the error is measured against
 *    ground truth rather than against a held-out approximation. It reports the
 *    two numbers Jin (2011) §5 cares about and an aggregate accuracy metric
 *    cannot show: where the true optimum sits in the model's ordering, and how
 *    much true score is lost by trusting the model's own argmax.
 * 2. {@link measureFidelity} — score the same lattice over a **stride** of the
 *    records and compare the ordering against the exact one, reusing the rank
 *    metrics of Issue #3927 against a complete ordering.
 * 3. {@link runFalseOptimumScenario} — drive the drift monitor of Issue #3933
 *    with residuals produced by a real fitted model on a problem whose
 *    optimum is known. Two knobs vary independently, so the report can say
 *    which one the monitor is responding to: how far the model **extrapolates**
 *    (the locality of the window it was fitted in) and whether the search
 *    **exploits** it. A third knob decides whether the coverage refusal of
 *    Issue #3933 is honoured, which is what production does — a refused
 *    candidate goes straight to exact evaluation and its prediction is never
 *    shown to the monitor.
 *
 * **None of it transfers to GRQ creature scores.** A surrogate that ranks
 * lattice points well says nothing about ranking 5,317-neuron forward-only
 * creatures on 90-day returns; that question belongs to Issues #3927 and
 * #3930, on real creatures against the real corpus.
 *
 * @module cheapProblemStudy
 */

import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import type { RequiredSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";
import { DEFAULT_SURROGATE_UNCERTAINTY_CONFIG } from "@config/SurrogateUncertaintyConfig.ts";
import { SurrogateGuard } from "@surrogate/SurrogateGuard.ts";
import type { DriftReading } from "@surrogate/DriftMonitor.ts";
import { CoverageRegion } from "@surrogate/CoverageRegion.ts";
import {
  assertVerdict,
  type SurrogateVerdict,
} from "@surrogate/UncertainSurrogate.ts";
import {
  gapResolution,
  kendallTau,
  spearmanRho,
  stridePhaseIndices,
  topKAgreement,
} from "../../scripts/lib/rankFidelity.ts";
import {
  SURROGATE_FAMILIES,
  type SurrogateFamily,
  type SurrogateModel,
  type TrainingPoint,
} from "../../scripts/lib/surrogateModels.ts";
import {
  approximateScores,
  type CheapProblem,
  type GroundTruth,
} from "./cheapProblem.ts";

/**
 * The warning every report of these studies carries.
 *
 * Issue #3935 requires the benchmark to state its own limits on its face: the
 * whole risk of a cheap-problem harness is that a good number on a toy surface
 * is read as evidence about GRQ.
 */
export const NON_TRANSFERABLE_NOTICE =
  "Scope: these are cheap analytic problems. Nothing measured here transfers " +
  "to GRQ creature scores — the 90-day equity objective is not a scaled-down " +
  "analytic function, its error surface is heavy-tailed and its ground truth " +
  "arrives a quarter late. Surrogate viability on real creatures is answered " +
  "by Issues #3927 and #3930, against the real corpus, and cannot be answered " +
  "here.";

/**
 * A family looked up by name, so a study names the model it ran.
 *
 * @param name - The family name, as `SURROGATE_FAMILIES` spells it.
 * @returns The family.
 * @throws {Error} When no family carries that name. A study that silently fell
 *   back to a default would report numbers for a model nobody chose.
 */
export function surrogateFamily(name: string): SurrogateFamily {
  const family = SURROGATE_FAMILIES.find((f) => f.name === name);
  if (family === undefined) {
    throw new Error(
      `no surrogate family named ${JSON.stringify(name)}; available: ` +
        SURROGATE_FAMILIES.map((f) => f.name).join(", "),
    );
  }
  return family;
}

/**
 * The lattice indices confined to the lower `locality` fraction of every
 * dimension — a **converged** population, which is the state a surrogate is
 * fitted in and the state Jin (2011) §5's false optimum arises from.
 *
 * @param problem - The problem, for its bounds.
 * @param points - The enumerated lattice.
 * @param locality - Fraction of each dimension's range to keep, in `(0, 1]`.
 * @returns The indices inside the window, ascending.
 * @throws {Error} When the fraction is not in `(0, 1]`, or the window is empty.
 */
export function localIndices(
  problem: CheapProblem,
  points: readonly (readonly number[])[],
  locality: number,
): number[] {
  if (!Number.isFinite(locality) || !(locality > 0) || locality > 1) {
    throw new Error(`locality must be in (0, 1], got ${locality}`);
  }
  const limit = problem.lower + locality * (problem.upper - problem.lower);
  const inside: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].every((c) => c <= limit)) inside.push(i);
  }
  if (inside.length === 0) {
    throw new Error(
      `a locality of ${locality} selected no lattice point of ` +
        `${problem.name}: the training window would be empty`,
    );
  }
  return inside;
}

/**
 * A reproducible sample of lattice indices, without replacement.
 *
 * @param total - Lattice size.
 * @param size - How many indices to draw.
 * @param seed - Seed, so a study is replayable.
 * @returns The drawn indices, ascending.
 * @throws {Error} When more indices are asked for than the lattice holds.
 */
export function sampleIndices(
  total: number,
  size: number,
  seed: number,
): number[] {
  if (!Number.isInteger(size) || size < 1 || size > total) {
    throw new Error(
      `cannot draw ${size} index/indices from a ${total}-point pool`,
    );
  }
  const rng = createSeededRng(seed);
  const pool = new Array<number>(total);
  for (let i = 0; i < total; i++) pool[i] = i;
  for (let i = 0; i < size; i++) {
    const j = rng.randomInt(i, total - 1);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, size).sort((a, b) => a - b);
}

/** How a surrogate's accuracy against ground truth is measured. */
export interface AccuracyOptions {
  /** Which family to fit. Default `"quadratic-polynomial"`. */
  readonly family?: string;
  /** Lattice points the model is fitted to. Default `120`. */
  readonly trainingSize?: number;
  /** Head of the ordering the top-K agreement is taken over. Default `10`. */
  readonly topK?: number;
  /** Seed for the training draw. Default `3935`. */
  readonly seed?: number;
}

/** What a fitted surrogate got right about a lattice it has seen part of. */
export interface SurrogateAccuracy {
  readonly problem: string;
  readonly family: string;
  /** Lattice points the model was fitted to. */
  readonly trainingSize: number;
  /** Lattice points the accuracy was measured over — all of them. */
  readonly evaluated: number;
  /** Root-mean-square residual `predicted - exact`, in score units. */
  readonly rmse: number;
  /** Mean absolute residual, in score units. */
  readonly meanAbsoluteResidual: number;
  /** Mean signed residual: positive means the model is optimistic. */
  readonly signedBias: number;
  /** `signedBias / meanAbsoluteResidual`, in `[-1, 1]`, or `null`. */
  readonly biasRatio: number | null;
  /** Spearman's ρ between the predicted and the exact ordering. */
  readonly spearmanRho: number;
  /** Kendall's τ-b between the same two orderings. */
  readonly kendallTau: number;
  /** Fraction of the exact top-K the model also puts in its top-K. */
  readonly topKAgreement: number;
  /** Head size the agreement was taken over. */
  readonly topK: number;
  /** Zero-based rank of the **true** optimum in the model's ordering. */
  readonly trueOptimumRank: number;
  /**
   * True score lost by trusting the model's argmax, as a fraction of the
   * lattice's full score range: `0` means the model's optimum **is** the true
   * optimum, `1` means it is the worst point on the lattice.
   *
   * This is the false-optimum reading of Jin (2011) §5, and it is deliberately
   * separate from the correlation metrics — a model can rank the lattice well
   * overall and still steer the search to a point that is materially worse.
   */
  readonly falseOptimumRegret: number;
}

/**
 * Fit a family to a sample of the lattice and grade it against **all** of it.
 *
 * @param problem - The cheap problem, for the report's name.
 * @param truth - Its enumerated ground truth.
 * @param options - Family, training size, head size and seed.
 * @returns The accuracy reading.
 * @throws {Error} When the family is unknown, the training draw is larger than
 *   the lattice, or the model returns a non-finite prediction.
 */
export function measureSurrogateAccuracy(
  problem: CheapProblem,
  truth: GroundTruth,
  options: AccuracyOptions = {},
): SurrogateAccuracy {
  const familyName = options.family ?? "quadratic-polynomial";
  const family = surrogateFamily(familyName);
  const trainingSize = options.trainingSize ?? 120;
  const topK = options.topK ?? 10;
  const seed = options.seed ?? 3935;
  const indices = sampleIndices(truth.points.length, trainingSize, seed);
  const points: TrainingPoint[] = indices.map((i) => ({
    features: truth.points[i],
    score: truth.scores[i],
  }));
  const model = family.fit(points);
  const predicted = new Array<number>(truth.points.length);
  let signedSum = 0;
  let absoluteSum = 0;
  let squareSum = 0;
  let argmax = 0;
  for (let i = 0; i < truth.points.length; i++) {
    const mean = model.predict(truth.points[i]).mean;
    if (!Number.isFinite(mean)) {
      throw new Error(
        `${familyName} predicted ${mean} for lattice point ${i} of ` +
          `${problem.name}: a non-finite prediction cannot be ranked`,
      );
    }
    predicted[i] = mean;
    const residual = mean - truth.scores[i];
    signedSum += residual;
    absoluteSum += Math.abs(residual);
    squareSum += residual * residual;
    if (mean > predicted[argmax]) argmax = i;
  }
  const evaluated = truth.points.length;
  const range = truth.optimumScore - truth.worstScore;
  const order = predicted
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  return {
    problem: problem.name,
    family: familyName,
    trainingSize,
    evaluated,
    rmse: Math.sqrt(squareSum / evaluated),
    meanAbsoluteResidual: absoluteSum / evaluated,
    signedBias: signedSum / evaluated,
    biasRatio: absoluteSum === 0 ? null : signedSum / absoluteSum,
    spearmanRho: spearmanRho(truth.scores, predicted),
    kendallTau: kendallTau(truth.scores, predicted),
    topKAgreement: topKAgreement(truth.scores, predicted, topK),
    topK,
    trueOptimumRank: order.findIndex((e) => e.index === truth.optimumIndex),
    falseOptimumRegret: range === 0
      ? 0
      : (truth.optimumScore - truth.scores[argmax]) / range,
  };
}

/** How a record stride reordered a lattice whose exact ordering is known. */
export interface FidelityMeasurement {
  readonly problem: string;
  /** Fraction of the records the cheap score averaged over. */
  readonly rate: number;
  /** Which stratum of the stride was taken. */
  readonly phase: number;
  /** Records the cheap score actually used. */
  readonly records: number;
  readonly spearmanRho: number;
  readonly kendallTau: number;
  readonly topKAgreement: number;
  readonly topK: number;
  /**
   * The largest exact score gap the cheap fidelity fails to order correctly,
   * in score units — the finest improvement it can be trusted to see.
   */
  readonly gapResolution: number;
  /** Zero-based rank of the true optimum under the cheap ordering. */
  readonly trueOptimumRank: number;
}

/**
 * Grade one cheap fidelity against the exact ordering of the whole lattice.
 *
 * @param problem - The cheap problem.
 * @param truth - Its enumerated ground truth.
 * @param rate - Fraction of the records the cheap score averages over.
 * @param phase - Which stratum of the stride to take. Default `0`.
 * @param topK - Head of the ordering the agreement is taken over. Default `10`.
 * @returns The measurement.
 * @throws {Error} As {@link stridePhaseIndices} for an invalid rate or phase.
 */
export function measureFidelity(
  problem: CheapProblem,
  truth: GroundTruth,
  rate: number,
  phase = 0,
  topK = 10,
): FidelityMeasurement {
  // The records the cheap score actually averaged over, read from the same
  // helper `approximateScores` uses rather than re-derived: a second copy of
  // the stride arithmetic is a second thing to get wrong.
  const records = stridePhaseIndices(problem.records.length, rate, phase)
    .length;
  const sampled = approximateScores(problem, truth.points, rate, phase);
  const order = sampled
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  return {
    problem: problem.name,
    rate,
    phase,
    records,
    spearmanRho: spearmanRho(truth.scores, sampled),
    kendallTau: kendallTau(truth.scores, sampled),
    topKAgreement: topKAgreement(truth.scores, sampled, topK),
    topK,
    gapResolution: gapResolution(truth.scores, sampled),
    trueOptimumRank: order.findIndex((e) => e.index === truth.optimumIndex),
  };
}

/**
 * What the scenario does with a candidate the coverage region refuses.
 *
 * `"honour"` is what production does: {@link ../../src/NEAT/PreSelection.ts}
 * records a prediction only for a candidate the model actually predicted, so a
 * refused candidate goes straight to exact evaluation and its (absent)
 * prediction never reaches the drift monitor. `"ignore"` shows the monitor
 * every residual, which is how a model that is extrapolating everywhere can be
 * characterised at all.
 */
export type CoveragePolicy = "ignore" | "honour";

/** How the candidates of one generation are chosen. */
export type SelectionRegime =
  /** By predicted rank — what an evolutionary algorithm actually does. */
  | "exploit"
  /** Uniformly from the unevaluated lattice — the control. */
  | "uniform";

/** How a false-optimum scenario is driven. */
export interface FalseOptimumOptions {
  /** Which family to fit. Default `"quadratic-polynomial"`. */
  readonly family?: string;
  /** Lattice points the model is fitted to. Default `120`. */
  readonly trainingSize?: number;
  /**
   * Fraction of each dimension the training sample is drawn from, in `(0, 1]`.
   *
   * The default `0.35` confines the model to a corner of the design space —
   * a converged population — so the search that then explores the rest is
   * asking the model to **extrapolate**, which is the situation the false
   * optimum of Jin (2011) §5 arises in and the one Issue #3933's coverage
   * refusal exists for. `1` fits the model to the whole lattice.
   */
  readonly trainingLocality?: number;
  /** Candidates exactly evaluated per generation. Default `16`. */
  readonly candidatesPerGeneration?: number;
  /** Generations to run. Default `8`. */
  readonly generations?: number;
  /** How candidates are chosen. Default `"exploit"`. */
  readonly selection?: SelectionRegime;
  /**
   * What to do with a candidate the coverage region refuses. Default
   * `"ignore"`; `"honour"` is the production path.
   */
  readonly coveragePolicy?: CoveragePolicy;
  /** Guard configuration. Defaults to the shipped guard. */
  readonly config?: RequiredSurrogateUncertaintyConfig;
  /** Seed for the training draw and the uniform control. Default `3935`. */
  readonly seed?: number;
}

/** What one false-optimum scenario did to the drift monitor. */
export interface FalseOptimumScenario {
  readonly problem: string;
  readonly family: string;
  readonly selection: SelectionRegime;
  /** Fraction of each dimension the model was fitted in. */
  readonly trainingLocality: number;
  /** What the scenario did with a refused candidate. */
  readonly coveragePolicy: CoveragePolicy;
  readonly generations: number;
  readonly candidatesPerGeneration: number;
  /** One reading per generation, in order. */
  readonly readings: readonly DriftReading[];
  /** True once the monitor disabled the surrogate path. */
  readonly escalated: boolean;
  /** The generation it fired in, or `null`. */
  readonly escalatedAtGeneration: number | null;
  /** Mean signed residual over the run, in score units. */
  readonly signedBias: number;
  /** Mean absolute residual over the run, in score units. */
  readonly meanAbsoluteResidual: number;
  /** Mean of the per-generation bias ratios, or `null`. */
  readonly generationBiasRatio: number | null;
  /**
   * True score lost at the model's **own** argmax over the whole lattice, as
   * a fraction of the lattice score range — `0` when the model's optimum is
   * the true optimum, `1` when it is the worst point on the lattice.
   *
   * This is the false optimum itself: the point a search that trusted the
   * model would converge on, graded against a ground truth no production run
   * has.
   */
  readonly modelOptimumRegret: number;
  /**
   * True score lost by taking the best point the run actually **evaluated**
   * instead of the lattice optimum, as a fraction of the score range.
   */
  readonly evaluatedRegret: number;
  /**
   * Candidates the coverage region of Issue #3933 would have **refused** to
   * predict, of `generations × candidatesPerGeneration`.
   *
   * Reported beside the drift reading because the two are the same defence at
   * different stages: the refusal declines to extrapolate in the first place,
   * and the monitor catches the bias when something extrapolates anyway.
   */
  readonly coverageRefusals: number;
  /**
   * Residuals the monitor was actually shown. Equal to every candidate under
   * `"ignore"`, and only the covered ones under `"honour"` — which is why a
   * run can refuse everything and leave the monitor with nothing to read.
   */
  readonly observedResiduals: number;
  /** The guard's own run line, for the report. */
  readonly line: string;
}

/**
 * Drive the drift monitor with residuals from a real fitted model.
 *
 * Nothing is fabricated: the model is fitted to a sample of the lattice and
 * the residuals are its own predictions against the exact lattice scores.
 *
 * Two knobs move independently, and a report that varies both at once cannot
 * say which one the monitor responded to:
 *
 * - `trainingLocality` decides how far the model **extrapolates**. Below `1`
 *   it is fitted in a corner of the design space — a converged population —
 *   and everything outside that corner is an extrapolation.
 * - `selection` decides whether the search **exploits** the model. `"exploit"`
 *   walks the model's own ordering from the top, which is what an evolutionary
 *   algorithm converging on the model's optimum does; `"uniform"` draws from
 *   the same pool without regard to what the model says.
 *
 * Hold one fixed and vary the other to attribute a firing to a cause. See
 * `docs/CHEAP_PROBLEM_BENCHMARK.md` for the readings this produces.
 *
 * @param problem - The cheap problem.
 * @param truth - Its enumerated ground truth.
 * @param options - Family, selection regime and guard configuration.
 * @returns What the monitor saw.
 * @throws {Error} When the lattice cannot supply the requested candidates.
 */
export function runFalseOptimumScenario(
  problem: CheapProblem,
  truth: GroundTruth,
  options: FalseOptimumOptions = {},
): FalseOptimumScenario {
  const familyName = options.family ?? "quadratic-polynomial";
  const family = surrogateFamily(familyName);
  const trainingSize = options.trainingSize ?? 120;
  const perGeneration = options.candidatesPerGeneration ?? 16;
  const generations = options.generations ?? 8;
  const selection = options.selection ?? "exploit";
  const coveragePolicy = options.coveragePolicy ?? "ignore";
  const locality = options.trainingLocality ?? 0.35;
  const config = options.config ?? DEFAULT_SURROGATE_UNCERTAINTY_CONFIG;
  const seed = options.seed ?? 3935;
  if (!Number.isInteger(perGeneration) || perGeneration < 1) {
    throw new Error(
      `candidatesPerGeneration must be an integer >= 1, got ${perGeneration}`,
    );
  }
  if (!Number.isInteger(generations) || generations < 1) {
    throw new Error(`generations must be an integer >= 1, got ${generations}`);
  }
  const window = localIndices(problem, truth.points, locality);
  if (trainingSize > window.length) {
    throw new Error(
      `a training locality of ${locality} leaves ` +
        `${window.length} lattice point(s) of ${problem.name}, fewer than ` +
        `the ${trainingSize} the model is to be fitted to: widen the ` +
        `locality or shrink the training set rather than fitting to a window ` +
        `that is not the one reported`,
    );
  }
  const drawn = sampleIndices(window.length, trainingSize, seed);
  const trainingIndices = drawn.map((i) => window[i]);
  const trained = new Set(trainingIndices);
  const rows = trainingIndices.map((i) => truth.points[i]);
  const model: SurrogateModel = family.fit(
    trainingIndices.map((i) => ({
      features: truth.points[i],
      score: truth.scores[i],
    })),
  );
  const region = CoverageRegion.fit(rows, {
    quantile: config.coverageQuantile,
    factor: config.coverageFactor,
    margin: config.coverageMargin,
  });
  const available = truth.points.length - trained.size;
  if (available < perGeneration * generations) {
    throw new Error(
      `${generations} generations of ${perGeneration} candidate(s) need ` +
        `${perGeneration * generations} unevaluated lattice points, and only ` +
        `${available} are left after fitting`,
    );
  }
  // Every unevaluated point, ordered by what the model says about it. The
  // exploit regime walks this list from the top — which is what an
  // evolutionary algorithm converging on the model's optimum does.
  const pool: { index: number; predicted: number }[] = [];
  for (let i = 0; i < truth.points.length; i++) {
    if (trained.has(i)) continue;
    pool.push({ index: i, predicted: model.predict(truth.points[i]).mean });
  }
  if (selection === "exploit") {
    pool.sort((a, b) => b.predicted - a.predicted || a.index - b.index);
  } else {
    const rng = createSeededRng(seed + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.randomInt(0, i);
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
  }

  // The point the model itself would steer a search to, graded against the
  // ground truth. Taken over the whole lattice rather than over the candidates
  // the run happened to draw, so it is the model's claim and not the draw's.
  let modelArgmax = pool[0].index;
  let modelArgmaxValue = -Infinity;
  for (const candidate of pool) {
    if (candidate.predicted > modelArgmaxValue) {
      modelArgmaxValue = candidate.predicted;
      modelArgmax = candidate.index;
    }
  }

  const guard = new SurrogateGuard(config);
  const readings: DriftReading[] = [];
  let bestEvaluated = -Infinity;
  let coverageRefusals = 0;
  let observedResiduals = 0;
  let cursor = 0;
  for (let generation = 1; generation <= generations; generation++) {
    for (let c = 0; c < perGeneration; c++) {
      const candidate = pool[cursor++];
      const exact = truth.scores[candidate.index];
      const refused = !region.classify(truth.points[candidate.index]).inside;
      if (refused) coverageRefusals++;
      // Every candidate is exactly evaluated either way — a refusal routes a
      // candidate to the exact path, it does not discard it. What the policy
      // decides is whether the monitor is shown a residual for it.
      if (!(refused && coveragePolicy === "honour")) {
        guard.observe(candidate.predicted, exact);
        observedResiduals++;
      }
      if (exact > bestEvaluated) bestEvaluated = exact;
    }
    readings.push(guard.closeGeneration(generation));
  }
  const diagnostics = guard.runDiagnostics;
  const range = truth.optimumScore - truth.worstScore;
  return {
    problem: problem.name,
    family: familyName,
    selection,
    trainingLocality: locality,
    coveragePolicy,
    generations,
    candidatesPerGeneration: perGeneration,
    readings,
    escalated: diagnostics.disabled,
    escalatedAtGeneration: diagnostics.disabledAtGeneration,
    signedBias: diagnostics.signedBias,
    meanAbsoluteResidual: diagnostics.meanAbsoluteResidual,
    generationBiasRatio: diagnostics.generationBiasRatio,
    modelOptimumRegret: range === 0
      ? 0
      : (truth.optimumScore - truth.scores[modelArgmax]) / range,
    evaluatedRegret: range === 0
      ? 0
      : (truth.optimumScore - bestEvaluated) / range,
    coverageRefusals,
    observedResiduals,
    line: guard.describeRun(),
  };
}

/** What the acquisition rule and the coverage region did on a cheap problem. */
export interface AcquisitionMeasurement {
  readonly problem: string;
  readonly family: string;
  readonly candidates: number;
  readonly slots: number;
  /** Candidates the coverage region refused to let the model predict. */
  readonly outOfDistribution: number;
  readonly outOfDistributionRate: number;
  /** Allocated slots that went to refused or least-certain candidates. */
  readonly explorationSlots: number;
  readonly uncertaintyFraction: number;
  /** The configured floor `uncertaintyFraction` is asserted against. */
  readonly floor: number;
  /**
   * True score lost by spending the slots where the acquisition rule sent
   * them rather than on the lattice optimum, as a fraction of the range.
   */
  readonly allocationRegret: number;
}

/**
 * Exercise the full uncertainty path — mandatory uncertainty, coverage
 * refusal, acquisition rule — on a problem whose answer is known.
 *
 * Only a family that reports a standard deviation is eligible: fabricating one
 * for a family that has none is precisely what Issue #3933 forbids, so a
 * family whose predictions carry `sd === null` is refused rather than
 * defaulted to zero.
 *
 * @param problem - The cheap problem.
 * @param truth - Its enumerated ground truth.
 * @param options - Family, training size, candidate and slot counts.
 * @returns The measurement.
 * @throws {Error} When the family reports no uncertainty.
 * @throws {SurrogateUncertaintyError} When the guard refuses the allocation.
 */
export function measureAcquisition(
  problem: CheapProblem,
  truth: GroundTruth,
  options: {
    readonly family?: string;
    readonly trainingSize?: number;
    readonly candidates?: number;
    readonly slots?: number;
    readonly config?: RequiredSurrogateUncertaintyConfig;
    readonly seed?: number;
  } = {},
): AcquisitionMeasurement {
  const familyName = options.family ?? "gaussian-process";
  const family = surrogateFamily(familyName);
  const trainingSize = options.trainingSize ?? 80;
  const candidateCount = options.candidates ?? 64;
  const slots = options.slots ?? 16;
  const config = options.config ?? DEFAULT_SURROGATE_UNCERTAINTY_CONFIG;
  const seed = options.seed ?? 3935;
  const trainingIndices = sampleIndices(
    truth.points.length,
    trainingSize,
    seed,
  );
  const trained = new Set(trainingIndices);
  const rows = trainingIndices.map((i) => truth.points[i]);
  const model = family.fit(
    trainingIndices.map((i) => ({
      features: truth.points[i],
      score: truth.scores[i],
    })),
  );
  const region = CoverageRegion.fit(rows, {
    quantile: config.coverageQuantile,
    factor: config.coverageFactor,
    margin: config.coverageMargin,
  });
  const candidateIndices = sampleIndices(
    truth.points.length,
    candidateCount,
    seed + 2,
  ).filter((i) => !trained.has(i));
  if (candidateIndices.length === 0) {
    throw new Error("every sampled candidate was already a training point");
  }
  const verdicts: SurrogateVerdict[] = candidateIndices.map((i) => {
    const features = truth.points[i];
    const reading = region.classify(features);
    if (!reading.inside && reading.verdict !== undefined) {
      return assertVerdict(familyName, reading.verdict);
    }
    const prediction = model.predict(features);
    if (prediction.sd === null) {
      throw new Error(
        `family ${JSON.stringify(familyName)} reports no uncertainty, so it ` +
          `cannot be consumed by an acquisition rule: Issue #3933 makes the ` +
          `uncertainty mandatory rather than optional`,
      );
    }
    return assertVerdict(familyName, {
      kind: "prediction",
      value: prediction.mean,
      uncertainty: prediction.sd,
    });
  });
  let bestExact = -Infinity;
  for (const i of trainingIndices) {
    if (truth.scores[i] > bestExact) bestExact = truth.scores[i];
  }
  const guard = new SurrogateGuard(config);
  const allocation = guard.allocate(
    verdicts,
    Math.min(slots, verdicts.length),
    bestExact,
  );
  guard.assertUncertaintyAllocation();
  let bestAllocated = -Infinity;
  for (const slot of allocation.slots) {
    const exact = truth.scores[candidateIndices[slot.index]];
    if (exact > bestAllocated) bestAllocated = exact;
  }
  const d = allocation.diagnostics;
  const range = truth.optimumScore - truth.worstScore;
  return {
    problem: problem.name,
    family: familyName,
    candidates: d.candidates,
    slots: d.slots,
    outOfDistribution: d.outOfDistribution,
    outOfDistributionRate: d.outOfDistributionRate,
    explorationSlots: d.outOfDistributionSlots + d.uncertaintySlots,
    uncertaintyFraction: d.uncertaintyFraction,
    floor: d.floor,
    allocationRegret: range === 0
      ? 0
      : (truth.optimumScore - bestAllocated) / range,
  };
}
