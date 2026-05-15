/**
 * Lightweight statistical helpers used by benchmarks and analysis scripts.
 *
 * Issue #2654 (cross-species breeding baseline): downstream strategy
 * sub-issues (#2653, #2614, etc.) need a shared two-sample test so they
 * can report `p` against the baseline shared-neuron-proportion
 * distribution captured by `bench/CrossSpeciesBreedingProportion.ts`.
 *
 * The implementation deliberately stays dependency-free — no SciPy, no
 * JSR stats package — so it can be called from `deno bench` without
 * extra permissions or network access.
 *
 * @module
 */

import { assert } from "@std/assert";

/**
 * Basic descriptive statistics for a sample.
 *
 * `stddev` is the **sample** standard deviation (divisor `n - 1`). For a
 * single-element sample `stddev` is `0` (not `NaN`) so callers can format
 * "mean ± stddev" without special-casing degenerate inputs.
 */
export interface DescriptiveStatistics {
  /** Sample size. */
  readonly n: number;
  /** Arithmetic mean. */
  readonly mean: number;
  /** Sample standard deviation (divisor `n - 1`). Zero when `n <= 1`. */
  readonly stddev: number;
  /** Minimum value in the sample. */
  readonly min: number;
  /** Maximum value in the sample. */
  readonly max: number;
}

/**
 * Result of a two-sample Mann–Whitney U test.
 *
 * The test uses the normal approximation with tie correction, which is
 * accurate enough for the sample sizes the cross-species baseline harness
 * runs (`N >= 20` per group). For very small samples (`n1 + n2 < 20`)
 * callers should treat the `pValue` as a rough indicator only.
 */
export interface MannWhitneyResult {
  /** U statistic for sample 1. */
  readonly u1: number;
  /** U statistic for sample 2. */
  readonly u2: number;
  /** The smaller of `u1` and `u2` — the standard test statistic. */
  readonly U: number;
  /** Normal-approximation z score (tie-corrected, with continuity correction). */
  readonly z: number;
  /**
   * Two-sided p-value from the normal approximation.
   *
   * Returns `1` when both samples are empty or identical (no separation),
   * never `NaN`.
   */
  readonly pValue: number;
  /** Size of sample 1. */
  readonly n1: number;
  /** Size of sample 2. */
  readonly n2: number;
}

/**
 * Computes mean, sample stddev, min and max for a finite numeric sample.
 *
 * @param values - The sample values. Must all be finite.
 * @throws {Error} When the sample is empty or contains a non-finite value.
 */
export function describe(values: readonly number[]): DescriptiveStatistics {
  assert(values.length > 0, "describe: sample is empty");
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    assert(Number.isFinite(v), `describe: non-finite value ${v}`);
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / values.length;
  let sqDiff = 0;
  for (const v of values) {
    const d = v - mean;
    sqDiff += d * d;
  }
  const stddev = values.length > 1
    ? Math.sqrt(sqDiff / (values.length - 1))
    : 0;
  return { n: values.length, mean, stddev, min, max };
}

/**
 * Assigns average ranks to a combined sample, returning per-value ranks
 * plus the sum of `t^3 - t` over tie groups used by the tie correction.
 */
function rankWithTies(
  combined: readonly number[],
): { ranks: number[]; tieCorrection: number } {
  const n = combined.length;
  const indexed = combined.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(n);
  let tieCorrection = 0;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && indexed[j].value === indexed[i].value) j++;
    // Ranks are 1-indexed; positions [i..j-1] all share the average rank.
    const avgRank = (i + 1 + j) / 2; // (i+1 + j-1+1) / 2 -> (i + j + 1) / 2
    for (let k = i; k < j; k++) ranks[indexed[k].index] = avgRank;
    const tieSize = j - i;
    if (tieSize > 1) tieCorrection += tieSize ** 3 - tieSize;
    i = j;
  }
  return { ranks, tieCorrection };
}

/**
 * Abramowitz & Stegun 26.2.17 approximation of the standard normal CDF.
 *
 * Accurate to ~7.5e-8 on the whole real line — more than enough for the
 * benchmark p-value display.
 */
function standardNormalCdf(z: number): number {
  // Constants from A&S 26.2.17.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-sample Mann–Whitney U test (also known as Wilcoxon rank-sum test).
 *
 * Uses the normal approximation with tie correction and a continuity
 * correction of `0.5`. Returns a two-sided p-value.
 *
 * Degenerate inputs are handled deterministically:
 * - Both samples empty: `U = 0`, `z = 0`, `pValue = 1`.
 * - One sample empty: `U = 0`, `z = 0`, `pValue = 1` — the test is
 *   undefined but reporting "no separation" is safer than `NaN`.
 * - Both samples constant and equal: `pValue = 1`.
 *
 * @param sample1 - First sample (e.g. baseline distribution).
 * @param sample2 - Second sample (e.g. new-strategy distribution).
 */
export function mannWhitneyU(
  sample1: readonly number[],
  sample2: readonly number[],
): MannWhitneyResult {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 === 0 || n2 === 0) {
    return { u1: 0, u2: 0, U: 0, z: 0, pValue: 1, n1, n2 };
  }

  const combined: number[] = new Array(n1 + n2);
  for (let i = 0; i < n1; i++) {
    const v = sample1[i];
    assert(Number.isFinite(v), `mannWhitneyU: non-finite value in sample1`);
    combined[i] = v;
  }
  for (let i = 0; i < n2; i++) {
    const v = sample2[i];
    assert(Number.isFinite(v), `mannWhitneyU: non-finite value in sample2`);
    combined[n1 + i] = v;
  }

  const { ranks, tieCorrection } = rankWithTies(combined);

  let rankSum1 = 0;
  for (let i = 0; i < n1; i++) rankSum1 += ranks[i];

  const u1 = rankSum1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const U = Math.min(u1, u2);

  const meanU = (n1 * n2) / 2;
  const N = n1 + n2;
  // Tie-corrected variance (see e.g. Lehmann, "Nonparametrics", 1.4):
  //   Var(U) = n1*n2/12 * ((N + 1) - sum(t^3 - t) / (N(N-1)))
  let variance = (n1 * n2 / 12) * (N + 1);
  if (N > 1 && tieCorrection > 0) {
    variance -= (n1 * n2 * tieCorrection) / (12 * N * (N - 1));
  }

  let z = 0;
  let pValue = 1;
  if (variance > 0) {
    // Continuity correction shrinks |U - meanU| by 0.5.
    const diff = U - meanU;
    const adjusted = diff > 0
      ? Math.max(0, diff - 0.5)
      : Math.min(0, diff + 0.5);
    z = adjusted / Math.sqrt(variance);
    pValue = 2 * standardNormalCdf(-Math.abs(z));
    if (pValue > 1) pValue = 1;
    if (pValue < 0) pValue = 0;
  }

  return { u1, u2, U, z, pValue, n1, n2 };
}
