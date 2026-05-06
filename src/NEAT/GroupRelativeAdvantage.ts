/**
 * GroupRelativeAdvantage.ts — DeepSeek V4 GRPO-style group-relative
 * advantage signal (Issue #2527).
 *
 * For a cohort of `G` candidates with rewards `r_i`, the advantage is
 *
 *     advantage_i = (r_i - mean(r)) / (std(r) + eps)
 *
 * Higher-than-average rewards get a positive advantage; lower-than-average
 * a negative one. The cohort itself supplies the baseline, so no separate
 * value-function network is needed.
 *
 * The same transform is reused two ways in NEAT-AI:
 *
 * 1. **Parent selection / fitness ranking** — replace the raw fitness
 *    score with the cohort-relative advantage so a "merely average"
 *    creature is not preferred over a much fitter one in another species.
 * 2. **Metropolis-Hastings acceptance** — instead of comparing the raw
 *    `delta = post - pre` to the cooling temperature, divide by the
 *    cohort's penalty standard deviation. The dimensionless advantage
 *    delta is invariant to the absolute scale of the cost function.
 *
 * The module is deliberately a pure function library: no Creature, Genus,
 * or Mutator imports. Callers compute the cohort, pass an array of
 * numbers, and receive an array of normalised advantages back.
 */

/** Defaults for the group-relative advantage transform. */
export const DEFAULT_ADVANTAGE_EPS = 1e-8;
export const DEFAULT_ADVANTAGE_CLIP = 10;
export const DEFAULT_MIN_COHORT_SIZE = 4;

/** Options for {@link computeGroupRelativeAdvantages}. */
export interface AdvantageOptions {
  /** Numerical stabiliser added to the standard deviation. */
  eps?: number;
  /** Symmetric clip applied to advantages; set to `Infinity` to disable. */
  clip?: number;
}

/** Summary statistics for a cohort. */
export interface AdvantageStats {
  readonly mean: number;
  readonly std: number;
  readonly count: number;
}

/**
 * Computes the population standard deviation (biased estimator, divide
 * by N) and mean of a cohort of finite numeric scores. Non-finite
 * entries are silently skipped.
 *
 * Population std is used rather than the sample std because GRPO treats
 * the cohort itself as the full distribution — there is no broader
 * "population" being estimated.
 *
 * @param scores - The cohort scores
 * @returns Mean, std, and the count of finite entries
 */
export function computeAdvantageStats(
  scores: readonly number[],
): AdvantageStats {
  let count = 0;
  let sum = 0;
  for (const s of scores) {
    if (!Number.isFinite(s)) continue;
    sum += s;
    count++;
  }
  if (count === 0) return { mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  let sqSum = 0;
  for (const s of scores) {
    if (!Number.isFinite(s)) continue;
    const d = s - mean;
    sqSum += d * d;
  }
  const std = Math.sqrt(sqSum / count);
  return { mean, std, count };
}

/**
 * Clamp a numeric value into the symmetric range `[-clip, +clip]`.
 *
 * @internal
 */
function clampSymmetric(value: number, clip: number): number {
  if (!Number.isFinite(clip) || clip <= 0) return value;
  if (value > clip) return clip;
  if (value < -clip) return -clip;
  return value;
}

/**
 * Computes the GRPO-style group-relative advantage for each cohort
 * member. Non-finite scores receive an advantage of `0` (no signal)
 * rather than propagating `NaN`.
 *
 * Properties guaranteed by this function:
 *
 * - **Shift-invariance**: adding the same constant to every score
 *   produces the same advantages.
 * - **Zero-variance safe**: when every score is identical (std=0) every
 *   advantage is exactly `0`.
 * - **Single-member cohort**: returns `[0]` rather than `NaN`.
 * - **Empty cohort**: returns `[]`.
 * - **Clipping**: results are clamped into `[-clip, +clip]` to keep a
 *   single outlier from dominating downstream selection.
 *
 * @param scores - The cohort scores
 * @param options - `eps` (default `1e-8`) and `clip` (default `10`)
 * @returns A new array of advantages, same length and order as `scores`
 */
export function computeGroupRelativeAdvantages(
  scores: readonly number[],
  options: AdvantageOptions = {},
): number[] {
  const eps = options.eps ?? DEFAULT_ADVANTAGE_EPS;
  const clip = options.clip ?? DEFAULT_ADVANTAGE_CLIP;
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const stats = computeAdvantageStats(scores);
  if (stats.count === 0) return scores.map(() => 0);
  // Zero-variance cohort: every advantage is 0 (also dodges divide-by-eps).
  if (stats.std === 0) return scores.map(() => 0);

  const denom = stats.std + eps;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = scores[i];
    if (!Number.isFinite(s)) {
      out[i] = 0;
      continue;
    }
    const adv = (s - stats.mean) / denom;
    out[i] = clampSymmetric(adv, clip);
  }
  return out;
}

/**
 * Normalises a raw cost delta by a cohort's penalty standard deviation,
 * producing a dimensionless quantity suitable for Metropolis-Hastings
 * acceptance under `mcmcAdvantageMode: "groupRelative"`.
 *
 *     normalisedDelta = delta / (cohortStd + eps)
 *
 * Why this is the right transform: the M-H acceptance probability is
 * `exp(-delta / T)`. If the absolute scale of `delta` shifts with the
 * cost function (e.g. swapping from MSE to cross-entropy), a fixed
 * temperature schedule no longer matches the same acceptance rate.
 * Dividing by `cohortStd` makes `delta` scale-free, so a single
 * temperature curriculum behaves consistently across cost functions.
 *
 * @param delta - Raw `post - pre` cost delta
 * @param cohortStd - Standard deviation of cohort costs/penalties
 * @param options - `eps` (default `1e-8`) and `clip` (default `10`)
 */
export function normaliseDeltaWithCohortStd(
  delta: number,
  cohortStd: number,
  options: AdvantageOptions = {},
): number {
  if (!Number.isFinite(delta)) return 0;
  const eps = options.eps ?? DEFAULT_ADVANTAGE_EPS;
  const clip = options.clip ?? DEFAULT_ADVANTAGE_CLIP;
  const denom = (Number.isFinite(cohortStd) && cohortStd > 0 ? cohortStd : 0) +
    eps;
  return clampSymmetric(delta / denom, clip);
}

/** mcmcAdvantageMode setting accepted by `MCMCConfig`. */
export type AdvantageMode = "absolute" | "groupRelative";
