/**
 * Racing (early-exit) configuration for native batch scoring — Issue #3928.
 *
 * Racing is the model-free member of the surrogate-assisted family
 * ([Jin, 2011](../../docs/comparison/REFERENCES.md)): score every candidate on
 * a prefix of the corpus and stop scoring one as soon as it cannot catch the
 * leader. Survivors still receive an **exact full-corpus score**, so the
 * fifth-decimal comparisons that decide elitism are unaffected — only the
 * abandoned candidates carry a partial number.
 *
 * Off by default. Every knob here widens or narrows the bound that decides
 * abandonment; see [`docs/RACING.md`](../../docs/RACING.md).
 *
 * @module RacingConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";

/** Caller-supplied racing options; every field is optional. */
export interface RacingConfig {
  /**
   * Enable racing on the native batch scoring path.
   *
   * Default: `false`. When the resolved scorer binary does not advertise
   * `--race-stdio` the run logs one warning and scores normally — an operator
   * who asked for racing is told they did not get it.
   */
  enabled?: boolean;
  /**
   * Fraction of the corpus a creature must be scored against before it may be
   * abandoned at all.
   *
   * Default: `0.2`. Records arrive in corpus order, which is **not** a random
   * sample, so an early chunk is not evidence about the whole corpus no matter
   * what the confidence bound says. Must be in `(0, 1]`.
   */
  minCorpusFraction?: number;
  /**
   * Confidence parameter `δ` of the Hoeffding bound (Maron & Moore, 1994).
   *
   * Default: `0.01` — each abandonment decision holds with probability
   * `1 - δ`. Smaller is more conservative (a wider bound, fewer
   * abandonments). Must be in `(0, 1)`.
   */
  confidence?: number;
  /**
   * Assumed range of the per-record cost, the `R` in the Hoeffding bound.
   *
   * Default: `1`. The bound is only valid for a bounded loss; a corpus whose
   * per-record error genuinely exceeds this range makes the bound optimistic,
   * so widen it rather than tightening `confidence`. Must be `> 0`.
   */
  errorRange?: number;
}

/** Fully resolved racing configuration used internally. */
export interface RequiredRacingConfig {
  enabled: boolean;
  minCorpusFraction: number;
  confidence: number;
  errorRange: number;
}

/** Conservative defaults: racing off, one fifth of the corpus, `δ = 0.01`. */
export const DEFAULT_RACING_CONFIG: RequiredRacingConfig = {
  enabled: false,
  minCorpusFraction: 0.2,
  confidence: 0.01,
  errorRange: 1,
};

function assertRange(
  name: string,
  value: number,
  min: number,
  max: number,
  minInclusive: boolean,
  maxInclusive: boolean,
): void {
  const lowOk = minInclusive ? value >= min : value > min;
  const highOk = maxInclusive ? value <= max : value < max;
  if (!Number.isFinite(value) || !lowOk || !highOk) {
    const low = minInclusive ? `[${min}` : `(${min}`;
    const high = maxInclusive ? `${max}]` : `${max})`;
    // Typed, like every sibling resolver — a consumer catching
    // `ConfigurationError` must not miss a `racing.*` fault.
    throw new ConfigurationError(
      `racing.${name} must be in ${low}, ${high}, got ${value}`,
      "OUT_OF_RANGE",
    );
  }
}

/**
 * Layer caller overrides over {@link DEFAULT_RACING_CONFIG}.
 *
 * Out-of-range values are **rejected**, never clamped: a typo that silently
 * became "abandon on the first chunk" would look exactly like a working race.
 */
export function resolveRacingConfig(
  overrides?: RacingConfig,
): RequiredRacingConfig {
  if (overrides === undefined) return { ...DEFAULT_RACING_CONFIG };
  const resolved: RequiredRacingConfig = {
    enabled: overrides.enabled ?? DEFAULT_RACING_CONFIG.enabled,
    minCorpusFraction: overrides.minCorpusFraction ??
      DEFAULT_RACING_CONFIG.minCorpusFraction,
    confidence: overrides.confidence ?? DEFAULT_RACING_CONFIG.confidence,
    errorRange: overrides.errorRange ?? DEFAULT_RACING_CONFIG.errorRange,
  };
  assertRange(
    "minCorpusFraction",
    resolved.minCorpusFraction,
    0,
    1,
    false,
    true,
  );
  assertRange("confidence", resolved.confidence, 0, 1, false, false);
  assertRange(
    "errorRange",
    resolved.errorRange,
    0,
    Number.MAX_VALUE,
    false,
    true,
  );
  return resolved;
}
