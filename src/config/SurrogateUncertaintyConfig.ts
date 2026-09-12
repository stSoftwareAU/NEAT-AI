/**
 * Surrogate uncertainty and acquisition configuration — Issue #3933.
 *
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) §4–§5 gives the remedy for
 * the false optimum in two halves: an **uncertainty estimate** beside every
 * prediction, and an **acquisition rule** that spends true evaluations where
 * the model is uncertain rather than only where it is optimistic (Jones,
 * Schonlau & Welch 1998). This module is the knobs for the second half, plus
 * the two refusals that protect the first — out-of-distribution detection and
 * the signed-bias drift monitor.
 *
 * **On by default when a surrogate screen runs.** The guard costs exact
 * evaluations of candidates the model calls mediocre, so it subtracts apparent
 * performance in the short run; that is precisely why it defaults on and why
 * [`docs/SURROGATE_UNCERTAINTY.md`](../../docs/SURROGATE_UNCERTAINTY.md) states
 * that the surrogate path must not run in production with it off. `enabled:
 * false` exists for the A/B arm that measures what it is worth, and for
 * nothing else.
 *
 * @module SurrogateUncertaintyConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { parseNumber } from "@config/ParseOptions.ts";

/**
 * The acquisition rules a true evaluation can be allocated by.
 *
 * Both are stated in the literature for **minimisation**; NEAT-AI scores are
 * higher-is-better, so each is computed on its maximisation mirror. The names
 * are kept because they are what Jin (2011) and Jones, Schonlau & Welch (1998)
 * call them, and renaming them would hide the lineage of the rule.
 */
export type AcquisitionRule =
  /**
   * Expected improvement over the best exact score seen so far — the rule of
   * Jones, Schonlau & Welch (1998). Spends on a candidate the model is
   * uncertain about *in proportion to how much it could gain*, so a wildly
   * uncertain mediocre candidate and a confident near-best one can both earn
   * an evaluation.
   */
  | "ei"
  /**
   * Confidence bound: `value + kappa * uncertainty`. Called the **lower**
   * confidence bound in the minimisation form; on a higher-is-better score it
   * is the same rule on the optimistic side. Cheaper and blunter than EI, and
   * the exploration weight is explicit in {@link
   * RequiredSurrogateUncertaintyConfig.kappa}.
   */
  | "lcb";

/** Every acquisition rule, for validation and for callers enumerating them. */
export const ACQUISITION_RULES: readonly AcquisitionRule[] = Object.freeze([
  "ei",
  "lcb",
]);

/** Caller-supplied options; every field is optional. */
export interface SurrogateUncertaintyConfig {
  /**
   * Whether the guard runs at all.
   *
   * Default: `true`. With it off, the surrogate path reverts to the predicted
   * rank argmax of Issue #3932 — which is the policy that guarantees the model
   * is never corrected where it is wrong. Off is a measurement arm, not a
   * production setting.
   */
  enabled?: boolean;
  /**
   * Which acquisition rule orders the exact-evaluation slots.
   *
   * Default: `"ei"`.
   */
  acquisition?: AcquisitionRule;
  /**
   * Exploration weight of the `"lcb"` rule, in `[0, 10]`.
   *
   * Default: `1.5`. Ignored by `"ei"`, which takes its exploration from the
   * posterior itself rather than from a constant.
   */
  kappa?: number;
  /**
   * Fraction of the exact-evaluation slots reserved for the candidates the
   * model is least sure about, whatever it predicts for them, in `[0, 1)`.
   *
   * Default: `0.2`. This is the floor the issue asks to be *enforced and
   * asserted*: if it drifts to zero the acquisition rule has degenerated to an
   * argmax and the model stops being corrected where it is wrong. `1` is
   * refused — an allocation that is entirely exploration has no acquisition
   * rule left in it.
   */
  minUncertaintyFraction?: number;
  /**
   * Quantile of the training set's own nearest-neighbour distances that sets
   * the coverage radius, in `(0, 1]`.
   *
   * Default: `0.95`.
   */
  coverageQuantile?: number;
  /**
   * Multiplier on that quantile distance, `>= 1`.
   *
   * Default: `1.5`. A candidate further than `quantile x factor` from every
   * training point is out of distribution and is refused a prediction.
   */
  coverageFactor?: number;
  /**
   * Standard deviations beyond the observed range of a descriptor slot that
   * still count as covered, `>= 0`.
   *
   * Default: `0.5`. A creature whose neuron count is far outside anything the
   * archive holds is out of distribution however close the remaining slots sit
   * — in a NEAT population that is not an edge case, it is the novel topology
   * the whole mechanism depends on.
   */
  coverageMargin?: number;
  /**
   * Consecutive generations of one-directional signed bias that disable the
   * surrogate path, `>= 1`.
   *
   * Default: `5`.
   */
  driftGenerations?: number;
  /**
   * How one-directional a generation's residuals must be to count towards
   * that streak, in `(0, 1]`.
   *
   * Default: `0.5`. The reading is `mean(residual) / mean(|residual|)`, which
   * is `±1` when every residual points the same way and near `0` for
   * symmetric noise — so the monitor is scale-free and cannot be defeated by a
   * lineage whose improvements are 1e-05 apart.
   */
  driftBiasRatio?: number;
  /**
   * Residuals a generation needs before its bias reading counts, `>= 2`.
   *
   * Default: `8`. Two predictions pointing the same way is a coin toss, not a
   * trend.
   */
  driftMinSamples?: number;
}

/** Fully resolved configuration used internally. */
export interface RequiredSurrogateUncertaintyConfig {
  enabled: boolean;
  acquisition: AcquisitionRule;
  kappa: number;
  minUncertaintyFraction: number;
  coverageQuantile: number;
  coverageFactor: number;
  coverageMargin: number;
  driftGenerations: number;
  driftBiasRatio: number;
  driftMinSamples: number;
}

/** The guard on, with the defaults the issue argues for. */
export const DEFAULT_SURROGATE_UNCERTAINTY_CONFIG: Readonly<
  RequiredSurrogateUncertaintyConfig
> = Object.freeze({
  enabled: true,
  acquisition: "ei" as AcquisitionRule,
  kappa: 1.5,
  minUncertaintyFraction: 0.2,
  coverageQuantile: 0.95,
  coverageFactor: 1.5,
  coverageMargin: 0.5,
  driftGenerations: 5,
  driftBiasRatio: 0.5,
  driftMinSamples: 8,
});

/**
 * Layer caller overrides over {@link DEFAULT_SURROGATE_UNCERTAINTY_CONFIG}.
 *
 * Invalid values are **rejected, never clamped**. A silently corrected
 * uncertainty floor is the exact failure this guard exists to detect: the run
 * would keep reporting an allocation fraction it never honoured.
 *
 * @param overrides - Partial caller options, or `undefined` for the defaults.
 *   Numeric fields accept the string form a CLI supplies.
 * @returns The resolved configuration.
 * @throws {ConfigurationError} When a field is present but invalid.
 */
export function resolveSurrogateUncertaintyConfig(
  overrides?: SurrogateUncertaintyConfig,
): RequiredSurrogateUncertaintyConfig {
  const raw = overrides as Record<string, unknown> | undefined;
  const resolved: RequiredSurrogateUncertaintyConfig = {
    enabled: overrides?.enabled ??
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.enabled,
    acquisition: overrides?.acquisition ??
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.acquisition,
    kappa: parseNumber(
      "preSelection.uncertainty.kappa",
      raw?.kappa,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.kappa,
    ),
    minUncertaintyFraction: parseNumber(
      "preSelection.uncertainty.minUncertaintyFraction",
      raw?.minUncertaintyFraction,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.minUncertaintyFraction,
    ),
    coverageQuantile: parseNumber(
      "preSelection.uncertainty.coverageQuantile",
      raw?.coverageQuantile,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.coverageQuantile,
    ),
    coverageFactor: parseNumber(
      "preSelection.uncertainty.coverageFactor",
      raw?.coverageFactor,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.coverageFactor,
    ),
    coverageMargin: parseNumber(
      "preSelection.uncertainty.coverageMargin",
      raw?.coverageMargin,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.coverageMargin,
    ),
    driftGenerations: parseNumber(
      "preSelection.uncertainty.driftGenerations",
      raw?.driftGenerations,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.driftGenerations,
    ),
    driftBiasRatio: parseNumber(
      "preSelection.uncertainty.driftBiasRatio",
      raw?.driftBiasRatio,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.driftBiasRatio,
    ),
    driftMinSamples: parseNumber(
      "preSelection.uncertainty.driftMinSamples",
      raw?.driftMinSamples,
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.driftMinSamples,
    ),
  };

  if (typeof resolved.enabled !== "boolean") {
    throw new ConfigurationError(
      `preSelection.uncertainty.enabled must be a boolean, got ` +
        `${JSON.stringify(resolved.enabled)}`,
      "INVALID_TYPE",
    );
  }
  if (!ACQUISITION_RULES.includes(resolved.acquisition)) {
    throw new ConfigurationError(
      `preSelection.uncertainty.acquisition must be one of ` +
        `${ACQUISITION_RULES.join(", ")}, got ` +
        `${JSON.stringify(resolved.acquisition)}`,
      "INVALID_TYPE",
    );
  }
  assertRange("kappa", resolved.kappa, 0, 10);
  // Strictly below 1: an allocation that is entirely exploration has no
  // acquisition rule left in it, and would be a different policy wearing this
  // one's diagnostics.
  assertRange(
    "minUncertaintyFraction",
    resolved.minUncertaintyFraction,
    0,
    1,
    true,
  );
  assertRange("coverageQuantile", resolved.coverageQuantile, 0, 1, false, true);
  assertRange("coverageFactor", resolved.coverageFactor, 1, Infinity);
  assertRange("coverageMargin", resolved.coverageMargin, 0, Infinity);
  assertRange("driftBiasRatio", resolved.driftBiasRatio, 0, 1, false, true);
  assertInteger("driftGenerations", resolved.driftGenerations, 1);
  assertInteger("driftMinSamples", resolved.driftMinSamples, 2);
  return resolved;
}

/** Reject a field outside its range, naming the bound it broke. */
function assertRange(
  field: string,
  value: number,
  min: number,
  max: number,
  exclusiveMax = false,
  exclusiveMin = false,
): void {
  const belowMin = exclusiveMin ? !(value > min) : !(value >= min);
  const aboveMax = exclusiveMax ? !(value < max) : !(value <= max);
  if (!Number.isFinite(value) || belowMin || aboveMax) {
    throw new ConfigurationError(
      `preSelection.uncertainty.${field} must be in ` +
        `${exclusiveMin ? "(" : "["}${min}, ${max}${
          exclusiveMax ? ")" : "]"
        }, got ${value}`,
      "OUT_OF_RANGE",
    );
  }
}

/** Reject a field that is not a finite integer at or above `min`. */
function assertInteger(field: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ConfigurationError(
      `preSelection.uncertainty.${field} must be an integer >= ${min}, got ` +
        `${value}`,
      value === Math.trunc(value) ? "OUT_OF_RANGE" : "NOT_INTEGER",
    );
  }
}
