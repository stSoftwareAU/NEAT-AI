/**
 * Deterministic, stratified record subsampling for fitness evaluation
 * (Issue #3257).
 *
 * Production evolution spends ≈95 % of `evolveDir` wall-clock scoring every
 * creature against a multi-GiB binary corpus. The largest remaining lever is
 * algorithmic: score each creature on a deterministic **subsample** of records
 * during the ranking pass, then confirm the elite on the full corpus. This
 * module owns the pure record-selection maths so both the streaming
 * `evaluateDir` reader and the tests share one implementation.
 *
 * The selection is intentionally **RNG-free**: a record at global index `i` is
 * kept iff `floor((i + 1) * rate) > floor(i * rate)`. This keeps exactly
 * `floor(N * rate)` records out of any prefix of `N`, spread as evenly as
 * possible (a stratified stride), and is fully deterministic across
 * generations and machines — a creature scored on the same corpus with the
 * same rate always sees the same records, so rank comparisons stay honest.
 *
 * An optional integer `phase` rotates the stride so different generations can
 * sample different strata without a random seed; `phase = 0` is the canonical
 * deterministic ordering.
 *
 * @module FitnessSubsample
 */

/** Minimum permitted fitness sample rate — mirrors `trainingSampleRate`. */
export const MIN_FITNESS_SAMPLE_RATE = 0.0001;

/** Default fitness sample rate: score the full corpus (today's behaviour). */
export const DEFAULT_FITNESS_SAMPLE_RATE = 1;

/**
 * Clamp a caller-supplied fitness sample rate into the valid `[MIN, 1]` range.
 *
 * `undefined`, non-finite, or out-of-range values collapse to the nearest
 * bound (with `undefined`/non-finite defaulting to `1` — the full corpus),
 * mirroring `resolveTrainingSampleRate` in `TrainingSetup.ts` so the two
 * sampling knobs behave identically.
 */
export function resolveFitnessSampleRate(rate?: number): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return DEFAULT_FITNESS_SAMPLE_RATE;
  }
  return Math.min(1, Math.max(MIN_FITNESS_SAMPLE_RATE, rate));
}

/**
 * Whether the record at `globalIndex` (0-based, counted across every shard and
 * batch of the corpus) is part of the deterministic stratified subsample.
 *
 * At `rate >= 1` every record is kept, so callers should short-circuit the
 * whole subsample machinery when the rate is `1` to avoid per-record overhead
 * on the default path.
 *
 * @param globalIndex - 0-based record position across the whole corpus.
 * @param rate - Resolved sample rate in `(0, 1]`.
 * @param phase - Optional non-negative integer stride rotation (default 0).
 */
export function shouldScoreRecord(
  globalIndex: number,
  rate: number,
  phase: number = 0,
): boolean {
  if (rate >= 1) return true;
  if (globalIndex < 0) return false;
  // Rotate by `phase` records so different generations sample different
  // strata while keeping the even stride and full determinism.
  const shifted = globalIndex + phase;
  return Math.floor((shifted + 1) * rate) > Math.floor(shifted * rate);
}

/**
 * Number of records the stratified stride keeps out of the first `total`
 * records at `rate` — exactly `floor(total * rate)` for `phase = 0`.
 *
 * Exposed for callers and tests that need to reason about the sampled count
 * (e.g. asserting a wall-clock saving is proportional to the rate).
 */
export function expectedSampledCount(total: number, rate: number): number {
  if (total <= 0) return 0;
  if (rate >= 1) return total;
  return Math.floor(total * resolveFitnessSampleRate(rate));
}
