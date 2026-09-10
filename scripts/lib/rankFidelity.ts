/**
 * Issue #3927 — rank fidelity of a sub-sampled fitness score.
 *
 * Jin (2011) §2/§4: an evolutionary algorithm never consumes a fitness
 * *value*, it consumes *comparisons*. An approximate fitness with terrible
 * absolute error but a perfect ordering costs nothing; one with excellent
 * absolute error that inverts two adjacent ranks sends the search somewhere
 * else. So the quantity that decides whether a cheap fidelity is usable is
 * rank preservation, not accuracy.
 *
 * This module holds the measurement arithmetic for that question, with no I/O
 * and no scoring: it takes two score vectors over the same creatures — the
 * full-corpus one and a sampled one — and reports how far the cheap ordering
 * departs from the expensive one.
 *
 * **Score convention.** Every function here takes *errors*, where **lower is
 * better** (`Creature.evaluateDir` returns an error). Rank 1 is the smallest
 * error. Both correlation coefficients are rank statistics, so their sign is
 * unchanged by that convention; the top-k and gap functions depend on it and
 * are written for it explicitly.
 *
 * Silent-failure guard: every entry point validates its inputs and throws
 * rather than returning a plausible number from ragged, empty, or non-finite
 * data. A rank statistic quietly computed over a `NaN` is the exact failure
 * this measurement exists to detect.
 */

/** Smallest population two orderings can be compared over. */
const MIN_POPULATION = 2;

/**
 * A rate is a fidelity in `(0, 1]`. Anything else — `NaN` from a mistyped
 * `--rates`, a negative, a rate above the full corpus — is refused rather
 * than measured.
 */
export function assertFidelityRate(rate: number): void {
  if (!Number.isFinite(rate) || !(rate > 0) || rate > 1) {
    throw new Error(`${rate} is not a fitness sample rate in (0, 1]`);
  }
}

/**
 * The stride a rate cuts the corpus at: rate `0.25` keeps every 4th record.
 *
 * Stride-and-phase — not a random draw — is the sampling Issue #3927 puts under
 * test, matching the scorer's `--sample-rate` / `--sample-phase` semantics
 * (NEAT-AI-scorer#310). It is deliberately **not** the sampler behind Issue
 * #3926's published corpora, which keeps each record independently with
 * probability `rate` (see `assertFitnessCorpusSampleRate` in
 * `src/architecture/FitnessCorpusProvenance.ts`, which validates the achieved
 * rate against a binomial band). A stride has *strata*, so its estimator has a
 * phase to vary; an independent draw does not, and phase sensitivity — a
 * criterion of this issue — could not be measured against it.
 */
export function strideForRate(rate: number): number {
  assertFidelityRate(rate);
  return Math.max(1, Math.round(1 / rate));
}

/**
 * How many *distinct* strata a rate has, capped at `requested`.
 *
 * Rate `0.5` has a stride of 2, so it has exactly two phases: asking for four
 * would measure phases 0 and 1 twice each and report a phase spread of zero
 * that the estimator does not have. Reporting the real count is the honest
 * answer; inventing duplicates is a silent lie about the estimator's noise.
 */
export function distinctPhaseCount(rate: number, requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`phases must be a positive integer, got ${requested}`);
  }
  return Math.min(requested, strideForRate(rate));
}

/**
 * The record indices a `(rate, phase)` stratum draws from a corpus of
 * `total` records — every index congruent to `phase` modulo the stride.
 */
export function stridePhaseIndices(
  total: number,
  rate: number,
  phase: number,
): number[] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`corpus must hold at least one record, got ${total}`);
  }
  const stride = strideForRate(rate);
  if (!Number.isInteger(phase) || phase < 0 || phase >= stride) {
    throw new Error(
      `phase ${phase} is outside [0, ${stride}) for rate ${rate}`,
    );
  }
  const indices: number[] = [];
  for (let i = phase; i < total; i += stride) indices.push(i);
  if (indices.length === 0) {
    throw new Error(
      `rate ${rate} phase ${phase} selected no records from ${total} — ` +
        `the sampled corpus would be empty`,
    );
  }
  return indices;
}

/** Refuses two score vectors that cannot be compared as orderings. */
function assertComparable(
  truth: readonly number[],
  sampled: readonly number[],
): void {
  if (truth.length !== sampled.length) {
    throw new Error(
      `score vectors differ in length: ${truth.length} vs ${sampled.length}`,
    );
  }
  if (truth.length < MIN_POPULATION) {
    throw new Error(
      `at least ${MIN_POPULATION} creatures are needed to compare orderings, ` +
        `got ${truth.length}`,
    );
  }
  for (let i = 0; i < truth.length; i++) {
    if (!Number.isFinite(truth[i]) || !Number.isFinite(sampled[i])) {
      throw new Error(
        `non-finite score at index ${i}: ${truth[i]} / ${sampled[i]}`,
      );
    }
  }
}

/**
 * Fractional ranks, ties sharing their average rank — the tie correction
 * Spearman's ρ needs to stay a correlation when two creatures score alike.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let at = 0;
  while (at < order.length) {
    let end = at + 1;
    while (end < order.length && order[end].value === order[at].value) end++;
    // Ranks are 1-based; a tie block spanning [at, end) shares its mean.
    const shared = (at + end + 1) / 2;
    for (let i = at; i < end; i++) ranks[order[i].index] = shared;
    at = end;
  }
  return ranks;
}

/** Pearson correlation, used here only over rank vectors. */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) {
    // One side is constant: every creature scored identically, so there is no
    // ordering to correlate. Reporting 0 would read as "uncorrelated"; this is
    // "unmeasurable", and it must not be mistaken for a measurement.
    throw new Error(
      "a score vector is constant — it carries no ordering to correlate",
    );
  }
  return cov / Math.sqrt(varA * varB);
}

/**
 * Spearman's ρ between the full-corpus and the sampled ordering, with the
 * average-rank tie correction. `1` is a perfectly preserved ordering.
 */
export function spearmanRho(
  truth: readonly number[],
  sampled: readonly number[],
): number {
  assertComparable(truth, sampled);
  return pearson(averageRanks(truth), averageRanks(sampled));
}

/**
 * Kendall's τ-b — the tie-corrected variant, because a sampled corpus can
 * genuinely score two creatures identically where the full corpus does not.
 */
export function kendallTau(
  truth: readonly number[],
  sampled: readonly number[],
): number {
  assertComparable(truth, sampled);
  const n = truth.length;
  let concordant = 0;
  let discordant = 0;
  let tiedTruth = 0;
  let tiedSampled = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dTruth = Math.sign(truth[i] - truth[j]);
      const dSampled = Math.sign(sampled[i] - sampled[j]);
      if (dTruth === 0 && dSampled === 0) continue;
      if (dTruth === 0) {
        tiedTruth++;
        continue;
      }
      if (dSampled === 0) {
        tiedSampled++;
        continue;
      }
      if (dTruth === dSampled) concordant++;
      else discordant++;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + tiedTruth) *
      (concordant + discordant + tiedSampled),
  );
  if (denominator === 0) {
    throw new Error(
      "no comparable pairs — τ is undefined for these score vectors",
    );
  }
  return (concordant - discordant) / denominator;
}

/** The indices of the `k` best (lowest-error) creatures, ties by index. */
function topKIndices(errors: readonly number[], k: number): number[] {
  return errors
    .map((error, index) => ({ error, index }))
    // A deterministic tie-break so the measurement is reproducible. It breaks
    // ties the same way on both sides, which biases top-k *towards* agreement
    // when the sampled score ties; `gapResolution` counts such a tie as a
    // failure to order, so the pessimistic reading is reported there.
    .sort((a, b) => a.error - b.error || a.index - b.index)
    .slice(0, k)
    .map((entry) => entry.index);
}

/**
 * The fraction of the full corpus's top `k` that the sampled score also puts
 * in its top `k`.
 *
 * This matters more than global ρ: selection and elitism only ever look at the
 * head of the ordering, so a ρ of 0.99 earned by correctly ranking the bottom
 * 40 creatures is worthless if it swaps the top 2.
 */
export function topKAgreement(
  truth: readonly number[],
  sampled: readonly number[],
  k: number,
): number {
  assertComparable(truth, sampled);
  if (!Number.isInteger(k) || k < 1 || k > truth.length) {
    throw new Error(
      `k must be an integer in [1, ${truth.length}], got ${k}`,
    );
  }
  const head = new Set(topKIndices(truth, k));
  let hits = 0;
  for (const index of topKIndices(sampled, k)) {
    if (head.has(index)) hits++;
  }
  return hits / k;
}

/**
 * Score-gap resolution, in absolute score units: the largest full-corpus gap
 * the sampled score **fails** to order correctly.
 *
 * Every pair whose full-corpus scores differ by strictly more than this value
 * is ordered correctly by the sampled score, so this is the finest improvement
 * the cheap fidelity can be trusted to see. `0` means no pair was inverted.
 *
 * A sampled *tie* over a pair the full corpus separates counts as a failure:
 * a score that cannot tell two creatures apart has not ordered them.
 */
export function gapResolution(
  truth: readonly number[],
  sampled: readonly number[],
): number {
  assertComparable(truth, sampled);
  let worst = 0;
  for (let i = 0; i < truth.length; i++) {
    for (let j = i + 1; j < truth.length; j++) {
      const gap = Math.abs(truth[i] - truth[j]);
      // The full corpus does not order this pair either, so the sampled score
      // cannot be wrong about it.
      if (gap === 0) continue;
      const resolved = sampled[i] !== sampled[j] &&
        Math.sign(truth[i] - truth[j]) === Math.sign(sampled[i] - sampled[j]);
      if (!resolved && gap > worst) worst = gap;
    }
  }
  return worst;
}

/**
 * The gaps between adjacent creatures in the full-corpus ordering — the scale
 * the estimator's noise has to beat to be useful. Zero gaps (identical
 * creatures) are dropped: they are not margins the search has to resolve.
 */
export function adjacentGaps(truth: readonly number[]): number[] {
  if (truth.length < MIN_POPULATION) {
    throw new Error(
      `at least ${MIN_POPULATION} scores are needed for adjacent gaps, ` +
        `got ${truth.length}`,
    );
  }
  const sorted = [...truth].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

/** The median of `values`; throws on an empty set rather than inventing one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median of an empty set is undefined");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How far one creature's sampled score moves when only the phase changes. */
export interface PhaseSpread {
  /** Largest per-creature spread across the phases measured. */
  readonly max: number;
  /** Mean per-creature spread across the phases measured. */
  readonly mean: number;
}

/**
 * Spread of a creature's score across the phases of one rate.
 *
 * Spread *is* the estimator's noise, measured rather than assumed: the same
 * creature and the same rate, differing only in which stratum was drawn.
 */
export function phaseSpread(
  errorsByPhase: readonly (readonly number[])[],
): PhaseSpread {
  if (errorsByPhase.length === 0) {
    throw new Error("no phases measured — there is no spread to report");
  }
  const population = errorsByPhase[0].length;
  for (const phase of errorsByPhase) {
    if (phase.length !== population) {
      throw new Error(
        `phases scored different populations: ${phase.length} vs ${population}`,
      );
    }
  }
  if (errorsByPhase.length === 1) {
    // One stratum cannot disagree with itself. Reporting 0 here would read as
    // "no noise"; it is "not measurable at this rate", so say so.
    return { max: Number.NaN, mean: Number.NaN };
  }
  let max = 0;
  let total = 0;
  for (let c = 0; c < population; c++) {
    let low = Infinity;
    let high = -Infinity;
    for (const phase of errorsByPhase) {
      if (!Number.isFinite(phase[c])) {
        throw new Error(`non-finite phase score for creature ${c}`);
      }
      low = Math.min(low, phase[c]);
      high = Math.max(high, phase[c]);
    }
    const spread = high - low;
    if (spread > max) max = spread;
    total += spread;
  }
  return { max, mean: total / population };
}

/** The thresholds the issue's failure signals are stated against. */
export interface FidelityThresholds {
  /** Top-1 agreement below this is a failure signal. Issue #3927: ~0.9. */
  readonly minTop1: number;
  /**
   * The finest improvement the search actually accepts, in score units. A gap
   * resolution coarser than this cannot rank the population. GRQ accepts
   * moves around `1e-05`.
   */
  readonly acceptGap: number;
  /**
   * The margin phase-to-phase noise must stay under — the median gap between
   * adjacent creatures in the full-corpus ordering.
   */
  readonly adjacentGap: number;
}

/** What one rate's evidence says about using it. */
export interface RateVerdict {
  readonly rate: number;
  readonly safe: boolean;
  /** Every failure signal this rate tripped, empty when it tripped none. */
  readonly failures: readonly string[];
}

/** The evidence one rate produced, reduced to what the verdict needs. */
export interface RateEvidence {
  readonly rate: number;
  /** Mean top-1 agreement across the rate's phases. */
  readonly top1: number;
  /** Worst (coarsest) gap resolution across the rate's phases. */
  readonly gapResolution: number;
  /** Largest per-creature phase spread, `NaN` when only one phase exists. */
  readonly phaseSpreadMax: number;
}

/**
 * Applies Issue #3927's three failure signals to one rate.
 *
 * The full corpus is not assessed — it *is* the ground truth, so it cannot
 * disagree with itself.
 */
export function assessRate(
  evidence: RateEvidence,
  thresholds: FidelityThresholds,
): RateVerdict {
  assertFidelityRate(evidence.rate);
  const failures: string[] = [];
  if (!(evidence.top1 >= thresholds.minTop1)) {
    failures.push(
      `top-1 agreement ${evidence.top1.toFixed(3)} is below ` +
        `${thresholds.minTop1}`,
    );
  }
  if (!(evidence.gapResolution <= thresholds.acceptGap)) {
    failures.push(
      `score-gap resolution ${
        evidence.gapResolution.toExponential(2)
      } is coarser than the ${
        thresholds.acceptGap.toExponential(2)
      } improvements the search accepts`,
    );
  }
  if (Number.isNaN(evidence.phaseSpreadMax)) {
    failures.push(
      "phase sensitivity is unmeasurable at this rate — it has one stratum",
    );
  } else if (!(evidence.phaseSpreadMax <= thresholds.adjacentGap)) {
    failures.push(
      `phase-to-phase spread ${
        evidence.phaseSpreadMax.toExponential(2)
      } exceeds the ${
        thresholds.adjacentGap.toExponential(2)
      } median gap between adjacent creatures`,
    );
  }
  return { rate: evidence.rate, safe: failures.length === 0, failures };
}

/**
 * The cheapest rate that tripped no failure signal, or `null` when none did.
 *
 * "No useful rate exists" is a legitimate — and per Issue #3927 valuable —
 * outcome, so it is returned as a result rather than thrown.
 */
export function recommendRate(
  verdicts: readonly RateVerdict[],
): number | null {
  const safe = verdicts.filter((verdict) => verdict.safe).map((v) => v.rate);
  return safe.length === 0 ? null : Math.min(...safe);
}
