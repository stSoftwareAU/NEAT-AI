/**
 * Stage 1 arithmetic for the memetic local-search budget — Issue #3934.
 *
 * The question is narrow and answerable: **does the rank the current rule
 * selects by predict the gain a gradient step realises?** Everything here is
 * the arithmetic of that answer, kept separate from the harness that produces
 * the events so the statistics can be tested on fixtures with known answers.
 *
 * Three choices are deliberate:
 *
 * - **Rank correlation, not fitness correlation.** Selection consumes an
 *   ordering, so the statistic that matters is whether rank orders gain. Both
 *   Spearman's ρ and Kendall's τ-b are reported: ρ is the familiar one, τ-b is
 *   the one that degrades gracefully when gains tie, and a disagreement between
 *   them is itself informative.
 * - **Ties are ties.** Average ranks for ρ and τ-b's tie correction, because a
 *   memetic run produces genuinely equal gains (two steps that changed nothing)
 *   and breaking those ties arbitrarily manufactures a correlation.
 * - **A failed step has no gain.** It is excluded from the correlation and
 *   counted separately; its wall-clock still counts against the policy that
 *   spent it, because the run paid for it.
 *
 * @module memeticGainAnalysis
 */

import {
  createSeededRng,
  type RandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** One observation: where the rule ranked a creature, and what it got. */
export interface GainObservation {
  /** Rank in the score-sorted population; `0` is the fittest. */
  readonly rank: number;
  /** Realised gain, or `undefined` when the step produced no score. */
  readonly gain: number | undefined;
  /** Wall-clock the step cost, in milliseconds. */
  readonly wallClockMs: number;
}

/**
 * The minimum events Stage 1 is allowed to report a correlation over.
 *
 * The issue's acceptance criterion, not a guess: "rank-vs-gain correlation
 * reported over ≥200 real training events". Below it the report refuses rather
 * than publishing a number whose confidence interval spans zero.
 */
export const MIN_STAGE1_EVENTS = 200;

/**
 * Magnitude of |ρ| below which rank is treated as carrying no usable signal.
 *
 * A gain predictor has to beat the rule it replaces, and the rule it replaces is
 * free. 0.2 is the conventional floor for a weak-but-real monotone association;
 * anything under it cannot survive the ~1e-05 accepted improvements this
 * lineage works at.
 */
export const STAGE2_MIN_ABS_RHO = 0.2;

/** Significance level the correlation must clear to count as predictable. */
export const STAGE2_MAX_P_VALUE = 0.05;

/** Permutation draws behind the reported p-value. */
export const PERMUTATION_DRAWS = 2_000;

/**
 * Average ranks of `values`, ties sharing their mean rank.
 *
 * @param values - The sample.
 * @returns Ranks in input order, 1-based, ties averaged.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].index] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Pearson correlation of two equal-length samples.
 *
 * @param xs - First sample.
 * @param ys - Second sample.
 * @returns The coefficient, or `0` when either sample has no variance — which
 *   is the honest reading: a constant column orders nothing.
 * @throws {Error} When the samples differ in length.
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) {
    throw new Error(
      `pearson needs equal-length samples, got ${xs.length} and ${ys.length}`,
    );
  }
  const n = xs.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return 0;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/**
 * Spearman's ρ: Pearson over average ranks.
 *
 * @param xs - First sample.
 * @param ys - Second sample.
 * @returns ρ in `[-1, 1]`.
 */
export function spearman(
  xs: readonly number[],
  ys: readonly number[],
): number {
  return pearson(averageRanks(xs), averageRanks(ys));
}

/**
 * Kendall's τ-b: concordance with the tie correction.
 *
 * τ-b rather than τ-a because a memetic run ties often — two steps that changed
 * nothing have equal gain — and τ-a counts those ties as disagreement.
 *
 * @param xs - First sample.
 * @param ys - Second sample.
 * @returns τ-b in `[-1, 1]`, or `0` when every pair ties on one side.
 * @throws {Error} When the samples differ in length.
 */
export function kendallTauB(
  xs: readonly number[],
  ys: readonly number[],
): number {
  if (xs.length !== ys.length) {
    throw new Error(
      `kendallTauB needs equal-length samples, got ${xs.length} and ` +
        `${ys.length}`,
    );
  }
  const n = xs.length;
  let concordant = 0;
  let discordant = 0;
  let tiedX = 0;
  let tiedY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(xs[j] - xs[i]);
      const dy = Math.sign(ys[j] - ys[i]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) {
        tiedX++;
        continue;
      }
      if (dy === 0) {
        tiedY++;
        continue;
      }
      if (dx === dy) concordant++;
      else discordant++;
    }
  }
  const pairsX = concordant + discordant + tiedX;
  const pairsY = concordant + discordant + tiedY;
  if (pairsX === 0 || pairsY === 0) return 0;
  return (concordant - discordant) / Math.sqrt(pairsX * pairsY);
}

/**
 * Two-sided permutation p-value for an observed |ρ|.
 *
 * A permutation test rather than the asymptotic t-approximation: the gains are
 * heavily tied and far from normal, and the approximation is optimistic exactly
 * there. Seeded, so the reported p-value is reproducible.
 *
 * @param xs - First sample.
 * @param ys - Second sample.
 * @param seed - Seed for the shuffles.
 * @param draws - Permutations to draw.
 * @returns The share of shuffles whose |ρ| reached the observed |ρ|, with the
 *   usual `+1` in numerator and denominator so a p-value is never exactly zero.
 */
export function permutationPValue(
  xs: readonly number[],
  ys: readonly number[],
  seed: number,
  draws: number = PERMUTATION_DRAWS,
): number {
  const observed = Math.abs(spearman(xs, ys));
  const rng: RandomNumberGenerator = createSeededRng(seed);
  const shuffled = [...ys];
  let atLeast = 0;
  for (let d = 0; d < draws; d++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.random() * (i + 1));
      const swap = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = swap;
    }
    if (Math.abs(spearman(xs, shuffled)) >= observed) atLeast++;
  }
  return (atLeast + 1) / (draws + 1);
}

/** What one selection policy realised, per unit of the budget it spent. */
export interface PolicySummary {
  /** Events the policy dispatched, failures included. */
  readonly events: number;
  /** Events that produced a score. */
  readonly scored: number;
  /** Events that produced no score — dispatched, paid for, measured nothing. */
  readonly failed: number;
  /** Mean realised gain over the scored events. */
  readonly meanGain: number;
  /**
   * Mean gain with the {@link TRIM_FRACTION} extremes of each tail removed.
   *
   * A memetic run produces genuine outliers of six orders of magnitude: a
   * creature whose outputs had exploded scores a colossal negative, and one
   * gradient step that reins it in realises a gain no other event comes near.
   * The raw mean is then that one event. Reported beside it, never instead of
   * it — the outliers are real, so they are trimmed visibly, not deleted.
   */
  readonly trimmedMeanGain: number;
  /** Largest single realised gain — the outlier, named rather than hidden. */
  readonly maxGain: number;
  /** Median realised gain over the scored events. */
  readonly medianGain: number;
  /** Share of scored events whose gain was above zero. */
  readonly improvedFraction: number;
  /** Training wall-clock the policy spent, in seconds. */
  readonly trainingSeconds: number;
  /**
   * Total realised gain per second of training.
   *
   * The issue's comparison metric, and it is a **total over total**, not a mean
   * of per-event rates: the run buys one pool of wall-clock, so a slow step that
   * gained a lot must not be averaged alongside a fast one that gained little as
   * though the two cost the same.
   */
  readonly gainPerSecond: number;
}

/**
 * Share of each tail {@link summarisePolicy} trims from its robust mean.
 *
 * 10 %: enough to drop the handful of explosive recoveries a memetic run
 * produces, far too little to change the centre of a thousand-event sample.
 */
export const TRIM_FRACTION = 0.1;

/**
 * Summarise one policy's events.
 *
 * @param observations - Every event the policy dispatched.
 * @returns The summary. An empty input yields zeroes, not `NaN`: no events is
 *   an absent measurement, and arithmetic on it must not look like a reading.
 */
export function summarisePolicy(
  observations: readonly GainObservation[],
): PolicySummary {
  const gains: number[] = [];
  let wallClockMs = 0;
  let failed = 0;
  for (const observation of observations) {
    wallClockMs += Math.max(0, observation.wallClockMs);
    if (observation.gain === undefined || !Number.isFinite(observation.gain)) {
      failed++;
      continue;
    }
    gains.push(observation.gain);
  }
  const trainingSeconds = wallClockMs / 1_000;
  if (gains.length === 0) {
    return {
      events: observations.length,
      scored: 0,
      failed,
      meanGain: 0,
      trimmedMeanGain: 0,
      maxGain: 0,
      medianGain: 0,
      improvedFraction: 0,
      trainingSeconds,
      gainPerSecond: 0,
    };
  }
  const total = gains.reduce((sum, gain) => sum + gain, 0);
  const sorted = [...gains].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianGain = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const trim = Math.floor(sorted.length * TRIM_FRACTION);
  const kept = sorted.length - 2 * trim > 0
    ? sorted.slice(trim, sorted.length - trim)
    : sorted;
  return {
    events: observations.length,
    scored: gains.length,
    failed,
    meanGain: total / gains.length,
    trimmedMeanGain: kept.reduce((sum, gain) => sum + gain, 0) / kept.length,
    maxGain: sorted[sorted.length - 1],
    medianGain,
    improvedFraction: gains.filter((gain) => gain > 0).length / gains.length,
    trainingSeconds,
    gainPerSecond: trainingSeconds > 0 ? total / trainingSeconds : 0,
  };
}

/** The rank-versus-gain reading over one set of events. */
export interface RankGainCorrelation {
  /** Events the correlation was computed over (scored events only). */
  readonly scored: number;
  /** Spearman's ρ of rank against gain. */
  readonly spearman: number;
  /** Kendall's τ-b of rank against gain. */
  readonly kendallTauB: number;
  /** Two-sided permutation p-value for |ρ|. */
  readonly pValue: number;
  /** Distinct ranks the sample covers — a one-rank sample orders nothing. */
  readonly distinctRanks: number;
}

/**
 * Correlate selection rank against realised gain.
 *
 * @param observations - Events; unscored ones are excluded from the statistic.
 * @param seed - Seed for the permutation test.
 * @returns The reading.
 */
export function correlateRankAgainstGain(
  observations: readonly GainObservation[],
  seed: number,
): RankGainCorrelation {
  const ranks: number[] = [];
  const gains: number[] = [];
  for (const observation of observations) {
    if (observation.gain === undefined || !Number.isFinite(observation.gain)) {
      continue;
    }
    ranks.push(observation.rank);
    gains.push(observation.gain);
  }
  return {
    scored: ranks.length,
    spearman: spearman(ranks, gains),
    kendallTauB: kendallTauB(ranks, gains),
    pValue: ranks.length >= 2 ? permutationPValue(ranks, gains, seed) : 1,
    distinctRanks: new Set(ranks).size,
  };
}

/** Whether Stage 2 — a gain predictor — is justified by Stage 1. */
export type Stage2Decision = "go" | "no-go" | "undecidable";

/** The go/no-go, and why. */
export interface Stage2Verdict {
  readonly decision: Stage2Decision;
  /** One line stating the reason, quoting the numbers it rests on. */
  readonly reason: string;
}

/**
 * Decide whether a gain predictor is worth building.
 *
 * Refuses to decide on too small or too narrow a sample rather than reading a
 * verdict out of noise — an undecidable gate is a stop, exactly as a clear
 * negative is.
 *
 * @param correlation - The rank-versus-gain reading from the unbiased
 *   (randomly-selected) events.
 * @param events - Events behind that reading, failures included.
 * @returns The verdict.
 */
export function stage2Verdict(
  correlation: RankGainCorrelation,
  events: number,
): Stage2Verdict {
  if (events < MIN_STAGE1_EVENTS) {
    return {
      decision: "undecidable",
      reason:
        `${events} training events is below the ${MIN_STAGE1_EVENTS} the ` +
        `issue requires; no correlation is reportable.`,
    };
  }
  if (correlation.distinctRanks < 3) {
    return {
      decision: "undecidable",
      reason:
        `the sample covers ${correlation.distinctRanks} distinct rank(s), ` +
        `so rank cannot be shown to order anything.`,
    };
  }
  const absRho = Math.abs(correlation.spearman);
  if (absRho < STAGE2_MIN_ABS_RHO) {
    return {
      decision: "no-go",
      reason: `rank explains nothing usable: |ρ| = ${absRho.toFixed(3)} is ` +
        `below the ${STAGE2_MIN_ABS_RHO} floor (p = ` +
        `${correlation.pValue.toFixed(4)}, n = ${correlation.scored}).`,
    };
  }
  if (correlation.pValue >= STAGE2_MAX_P_VALUE) {
    return {
      decision: "no-go",
      reason: `|ρ| = ${absRho.toFixed(3)} did not survive the permutation ` +
        `test (p = ${correlation.pValue.toFixed(4)} >= ` +
        `${STAGE2_MAX_P_VALUE}, n = ${correlation.scored}).`,
    };
  }
  return {
    decision: "go",
    reason: `rank orders gain: ρ = ${correlation.spearman.toFixed(3)}, ` +
      `τ-b = ${correlation.kendallTauB.toFixed(3)}, p = ` +
      `${correlation.pValue.toFixed(4)} over ${correlation.scored} scored ` +
      `events.`,
  };
}
