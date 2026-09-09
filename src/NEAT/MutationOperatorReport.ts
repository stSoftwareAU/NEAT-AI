/**
 * MutationOperatorReport.ts - Data shapes for per-operator mutation outcome
 * telemetry (Issue #3971).
 *
 * Kept free of any `Creature` import so `@config/TrainingEvent.ts` can carry
 * the report on `generation_complete` without pulling the evolution graph into
 * the config layer.
 *
 * The aggregate `MCMCDiagnostics` counters (Issue #2201) answer "how often was
 * a mutation accepted?" but not "which operator was rejected?". This report is
 * the per-operator breakdown: it distinguishes an operator that never changed
 * anything (`noChange`) from one whose change was thrown away (`reverted` /
 * `rejected`), and records the score-delta distribution and depth bucket of the
 * structural changes that did survive.
 */

import type { LayerBucket } from "@neat/LayerBucket.ts";

/**
 * Depth bucket of a mutation site. `unknown` covers operators that do not
 * name a neuron site (weight/bias mutations) and sites that could not be
 * resolved.
 */
export type MutationDepthBucket = LayerBucket | "unknown";

/** Every bucket a mutation site can fall into, in report order. */
export const MUTATION_DEPTH_BUCKETS: readonly MutationDepthBucket[] = Object
  .freeze([
    "input-adjacent",
    "mid",
    "output-adjacent",
    "unknown",
  ]);

/**
 * Order statistics of a set of score deltas.
 *
 * The mean is deliberately absent: at the 1e-5 margins production runs decide
 * on, a mean over a heavy-tailed delta says nothing (Issue #3971).
 */
export interface ScoreDeltaDistribution {
  /** Number of deltas in the sample. */
  readonly count: number;
  /** Smallest observed delta. */
  readonly min: number;
  /** Median observed delta (mean of the two middle values when even). */
  readonly median: number;
  /** Largest observed delta. */
  readonly max: number;
}

/**
 * Outcome counters for a single mutation operator over one generation.
 */
export interface MutationOperatorSummary {
  /** Times the operator was invoked. */
  readonly proposed: number;
  /**
   * Times the operator reported no change, or changed nothing observable
   * (the creature's UUID did not rotate). These cost nothing and are **not**
   * rejections.
   */
  readonly noChange: number;
  /** Times the operator actually changed the creature. */
  readonly applied: number;
  /**
   * Applied changes rolled back before any evaluation — a failed post-mutation
   * repair, or a Metropolis-Hastings rejection.
   */
  readonly reverted: number;
  /** Metropolis-Hastings acceptances covering a batch containing this operator. */
  readonly mcmcAccepted: number;
  /** Metropolis-Hastings rejections covering a batch containing this operator. */
  readonly mcmcRejected: number;
  /** Offspring carrying this operator that reached `Fitness.calculate()`. */
  readonly evaluated: number;
  /** Of those, how many survived selection into the next generation. */
  readonly accepted: number;
  /** Of those, how many did not survive selection. */
  readonly rejected: number;
  /**
   * Evaluation wall-clock (ms) spent on offspring carrying this operator.
   * An offspring carrying several operators charges its full evaluation to
   * each of them, so the per-operator figures may sum past
   * {@link MutationAttributionSummary.evaluationMs}.
   */
  readonly evaluationMs: number;
  /**
   * Distribution of (offspring score − parent score) over evaluated offspring
   * carrying this operator. Absent when no evaluated offspring had a usable
   * baseline.
   */
  readonly scoreDelta?: ScoreDeltaDistribution;
  /** Evaluated offspring with no usable baseline score, so no delta sample. */
  readonly deltaUnavailable: number;
  /** Applied mutations by depth bucket of the mutation site. */
  readonly depthBuckets: Readonly<Record<MutationDepthBucket, number>>;
  /** Evaluated offspring where this was the only operator applied. */
  readonly soleAttributed: number;
  /** Evaluated offspring that also carried at least one other operator. */
  readonly coAttributed: number;
}

/**
 * Aggregate Metropolis-Hastings decision counts for the generation.
 *
 * These are per-*decision*, not per-operator, so they reconcile exactly with
 * `MCMCDiagnostics.getGenerationStats()`. A discrepancy means attribution is
 * dropping or double-counting decisions.
 */
export interface MutationMcmcTotals {
  /** Decisions taken (accepted + rejected). */
  readonly proposed: number;
  /** Decisions that accepted the mutation batch. */
  readonly accepted: number;
  /** Decisions that rejected the mutation batch. */
  readonly rejected: number;
}

/**
 * How attribution behaved this generation, so the report never pretends a
 * co-attributed operator was credited alone.
 */
export interface MutationAttributionSummary {
  /** Evaluated offspring whose outcome was resolved this generation. */
  readonly resolvedOffspring: number;
  /** Of those, how many carried more than one mutation operator. */
  readonly multiOperatorOffspring: number;
  /**
   * Mutated offspring that never reached `Fitness.calculate()` — replaced by
   * the de-duplicator, culled, or dropped from the population. They contribute
   * to neither `evaluated` nor `evaluationMs`.
   */
  readonly discardedOffspring: number;
  /**
   * Total evaluation wall-clock (ms) across resolved offspring, counted once
   * per offspring. Compare against the per-operator `evaluationMs` sum to see
   * how much co-attribution inflates the per-operator figures.
   */
  readonly evaluationMs: number;
  /** Plain-language statement of the multi-operator attribution ambiguity. */
  readonly note: string;
}

/**
 * One generation of per-operator mutation outcome telemetry.
 */
export interface MutationOperatorReport {
  /** Operator name (e.g. `ADD_NODE`) → its outcome counters. */
  readonly operators: Readonly<Record<string, MutationOperatorSummary>>;
  /** Aggregate M-H decisions, for reconciliation against `MCMCDiagnostics`. */
  readonly mcmc: MutationMcmcTotals;
  /** Attribution bookkeeping, including the multi-operator ambiguity note. */
  readonly attribution: MutationAttributionSummary;
}

/**
 * The ambiguity every consumer of this report has to live with: an offspring
 * may carry several mutations, and each is credited with the whole outcome.
 */
export const MULTI_OPERATOR_ATTRIBUTION_NOTE =
  "An offspring carrying several mutations is attributed to every operator " +
  "applied, so an operator that only ever appears alongside others cannot be " +
  "credited with an outcome alone — compare soleAttributed against " +
  "coAttributed before drawing a conclusion.";
