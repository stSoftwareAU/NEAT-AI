/**
 * Weight/bias magnitude clamping utilities.
 *
 * Issue #2378: During long-running GRQ evolve runs, synapse weights and
 * neuron biases have been observed to drift to magnitudes up to 1.15e+195,
 * which then trigger "Max is too large" / "Total is too large" warnings in
 * `Score.ts`. Runaway values typically arise from repeated weight
 * multiplication in the compaction passes (e.g. COMPLEMENT bypass folds
 * `wAB * wBC` into a single synapse).
 *
 * This helper provides a single, shared clamp that:
 *   1. Caps `|value|` to {@link MAX_SAFE_WEIGHT_BIAS} (`Number.MAX_SAFE_INTEGER`).
 *   2. Preserves the sign of the input.
 *   3. Leaves finite, in-range values untouched — no allocation, no logging.
 *
 * Callers that want to know whether clamping occurred can use
 * {@link clampWeightBiasDetail} to receive both the clamped value and a
 * boolean flag, which higher-level code can use to emit a single warn-level
 * log with the creature UUID instead of a per-call `info` line.
 *
 * @module
 */

/**
 * Maximum absolute weight or bias magnitude that is allowed to flow through
 * the scorer. Values above this bound saturate downstream penalty functions
 * and can cause numerical instability in the WASM activation path.
 *
 * This matches the pre-existing overflow guard in `Score.ts`.
 */
export const MAX_SAFE_WEIGHT_BIAS = Number.MAX_SAFE_INTEGER;

/**
 * Clamp a weight or bias value to the safe range `[-MAX_SAFE_WEIGHT_BIAS, MAX_SAFE_WEIGHT_BIAS]`.
 *
 * NaN and non-finite inputs are preserved as-is so that upstream validators
 * (e.g. `assertFiniteNumber`) can still flag them as corruption; this
 * helper is a defence-in-depth clamp, not a replacement for validation.
 *
 * @param value - The weight or bias value to clamp.
 * @returns The clamped value (sign-preserving).
 */
export function clampWeightBias(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value > MAX_SAFE_WEIGHT_BIAS) return MAX_SAFE_WEIGHT_BIAS;
  if (value < -MAX_SAFE_WEIGHT_BIAS) return -MAX_SAFE_WEIGHT_BIAS;
  return value;
}

/** Result of {@link clampWeightBiasDetail}. */
export interface ClampResult {
  /** The clamped value. */
  value: number;
  /** True iff the input exceeded `MAX_SAFE_WEIGHT_BIAS` in magnitude. */
  clamped: boolean;
}

/**
 * Clamp a weight or bias and report whether clamping actually occurred.
 *
 * Useful when the caller wants to emit a single aggregated warn-level log
 * (e.g. "clamped N synapse weights for creature <uuid>") rather than a
 * per-value info line.
 *
 * @param value - The weight or bias value to clamp.
 * @returns `{ value, clamped }` — the clamped value and a boolean flag.
 */
export function clampWeightBiasDetail(value: number): ClampResult {
  if (!Number.isFinite(value)) return { value, clamped: false };
  if (value > MAX_SAFE_WEIGHT_BIAS) {
    return { value: MAX_SAFE_WEIGHT_BIAS, clamped: true };
  }
  if (value < -MAX_SAFE_WEIGHT_BIAS) {
    return { value: -MAX_SAFE_WEIGHT_BIAS, clamped: true };
  }
  return { value, clamped: false };
}
