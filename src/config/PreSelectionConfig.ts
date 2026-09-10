/**
 * Offspring pre-selection configuration — Issue #3932.
 *
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) §4 treats **pre-selection**
 * as a lever distinct from evolution control. Evolution control decides how to
 * spend the budget on the individuals you already have (Issue #3931,
 * [`EvolutionControlConfig`](./EvolutionControlConfig.ts)); pre-selection
 * changes how many individuals you make: breed a **surplus**, screen it
 * cheaply, and spend the true evaluation only on the survivors. The population
 * size does not move — the number of candidates considered per generation does.
 *
 * **Off by default (`ratio: 1`, `screen: "none"`).** With the defaults the
 * breeder is asked for exactly the offspring the population budget calls for,
 * nothing is screened and nothing is discarded, which is the behaviour of every
 * build before this one. See
 * [`docs/PRE_SELECTION.md`](../../docs/PRE_SELECTION.md).
 *
 * The issue spells these `preSelectionRatio` and `preSelectionScreen`; they are
 * nested under one `preSelection` key here so the surface matches the
 * `evolutionControl` policy it composes with.
 *
 * @module PreSelectionConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";

/**
 * The cheap screens a surplus of offspring can be ranked by.
 *
 * A screen never assigns a fitness — it only decides which candidates are worth
 * measuring — which is why an imperfect one is tolerable here and is not
 * tolerable as a score.
 */
export type PreSelectionScreenName =
  /** No screen: nothing is over-generated and nothing is discarded. */
  | "none"
  /**
   * A low-rate cheap evaluation (Issue #3926's sampled corpus). The evaluator
   * is supplied by the caller — nothing in the evolution loop scores a sampled
   * corpus today, and a screen with no evaluator behind it is refused rather
   * than run on a fabricated number.
   */
  | "sampled"
  /**
   * A fitness approximation fitted to the exact scores the run has already
   * paid for, predicting from the structural descriptor of Issue #3929.
   */
  | "surrogate";

/** Every screen name, for validation and for callers enumerating them. */
export const PRE_SELECTION_SCREENS: readonly PreSelectionScreenName[] = Object
  .freeze(["none", "sampled", "surrogate"]);

/**
 * Largest over-generation ratio accepted.
 *
 * Breeding and mutation are paid for **before** the screen runs, so the surplus
 * is not free: at ten offspring per slot the breeder does ten times the work to
 * fill the same population. A ratio past this is refused rather than quietly
 * turning the saving into a cost.
 */
export const MAX_PRE_SELECTION_RATIO = 10;

/** Caller-supplied pre-selection options; every field is optional. */
export interface PreSelectionConfig {
  /**
   * Offspring generated per population slot — the issue's `preSelectionRatio`.
   *
   * Default: `1`, which disables the stage. Must be in
   * `[1, MAX_PRE_SELECTION_RATIO]`; fractional ratios are allowed and the
   * target is rounded up.
   */
  ratio?: number;
  /**
   * Which cheap screen ranks the surplus — the issue's `preSelectionScreen`.
   *
   * Default: `"none"`. A screen other than `"none"` requires `ratio > 1`, and
   * `ratio > 1` requires a screen: over-generating and then discarding without
   * a screen is a random cull, not pre-selection.
   */
  screen?: PreSelectionScreenName;
  /**
   * Fraction of the survivors drawn uniformly at random from the whole
   * candidate pool rather than by screen rank, in `[0, 1]`.
   *
   * Default: `0.25`. Screening exclusively on predicted quality is a diversity
   * sink — it systematically discards the structurally unusual candidates the
   * screen is least able to judge, which are exactly the ones NEAT depends on
   * for novel topology. `0` turns that protection off; `1` keeps survivors
   * entirely at random, which is the control arm the diversity comparison
   * needs.
   */
  randomSurvivorFraction?: number;
  /**
   * `"surrogate"` screen: how many `(descriptor, exact score)` pairs the model
   * is fitted to, most recent first.
   *
   * Default: `256`. Must be an integer `>= 3` — no model here can honestly be
   * fitted to fewer points than that. Bounding the window also bounds the
   * memory the screen holds across a long run.
   */
  surrogateWindow?: number;
  /**
   * `"surrogate"` screen: how many nearest neighbours a prediction averages.
   *
   * Default: `5`. Must be an integer `>= 1`.
   */
  surrogateNeighbours?: number;
}

/** Fully resolved pre-selection configuration used internally. */
export interface RequiredPreSelectionConfig {
  ratio: number;
  screen: PreSelectionScreenName;
  randomSurvivorFraction: number;
  surrogateWindow: number;
  surrogateNeighbours: number;
}

/** The stage off; the remaining values are the defaults a screen would use. */
export const DEFAULT_PRE_SELECTION_CONFIG: Readonly<
  RequiredPreSelectionConfig
> = Object.freeze({
  ratio: 1,
  screen: "none" as PreSelectionScreenName,
  randomSurvivorFraction: 0.25,
  surrogateWindow: 256,
  surrogateNeighbours: 5,
});

/**
 * Layer caller overrides over {@link DEFAULT_PRE_SELECTION_CONFIG}.
 *
 * Invalid values are **rejected, never clamped**. A silently corrected ratio
 * would change how many creatures a generation discards without saying so, and
 * the whole risk of this stage is a diversity collapse nothing in the fitness
 * trace reveals.
 *
 * @param overrides - Partial caller options, or `undefined` for the defaults.
 * @returns The resolved configuration.
 * @throws {ConfigurationError} When a field is present but invalid, or when
 *   the ratio and the screen contradict each other.
 */
export function resolvePreSelectionConfig(
  overrides?: PreSelectionConfig,
): RequiredPreSelectionConfig {
  const resolved: RequiredPreSelectionConfig = {
    ratio: overrides?.ratio ?? DEFAULT_PRE_SELECTION_CONFIG.ratio,
    screen: overrides?.screen ?? DEFAULT_PRE_SELECTION_CONFIG.screen,
    randomSurvivorFraction: overrides?.randomSurvivorFraction ??
      DEFAULT_PRE_SELECTION_CONFIG.randomSurvivorFraction,
    surrogateWindow: overrides?.surrogateWindow ??
      DEFAULT_PRE_SELECTION_CONFIG.surrogateWindow,
    surrogateNeighbours: overrides?.surrogateNeighbours ??
      DEFAULT_PRE_SELECTION_CONFIG.surrogateNeighbours,
  };

  if (!PRE_SELECTION_SCREENS.includes(resolved.screen)) {
    throw new ConfigurationError(
      `preSelection.screen must be one of ${PRE_SELECTION_SCREENS.join(", ")}` +
        `, got ${JSON.stringify(resolved.screen)}`,
      "INVALID_TYPE",
    );
  }
  if (
    !Number.isFinite(resolved.ratio) || resolved.ratio < 1 ||
    resolved.ratio > MAX_PRE_SELECTION_RATIO
  ) {
    throw new ConfigurationError(
      `preSelection.ratio must be in [1, ${MAX_PRE_SELECTION_RATIO}], got ` +
        `${resolved.ratio}`,
      "OUT_OF_RANGE",
    );
  }
  if (
    !Number.isFinite(resolved.randomSurvivorFraction) ||
    resolved.randomSurvivorFraction < 0 || resolved.randomSurvivorFraction > 1
  ) {
    throw new ConfigurationError(
      `preSelection.randomSurvivorFraction must be in [0, 1], got ` +
        `${resolved.randomSurvivorFraction}`,
      "OUT_OF_RANGE",
    );
  }
  assertInteger("surrogateWindow", resolved.surrogateWindow, 3);
  assertInteger("surrogateNeighbours", resolved.surrogateNeighbours, 1);

  // The two knobs only mean anything together. Either half on its own is a
  // request the stage cannot honour, and honouring half of it silently is how
  // a run ends up culling offspring at random.
  if (resolved.ratio > 1 && resolved.screen === "none") {
    throw new ConfigurationError(
      `preSelection.ratio ${resolved.ratio} over-generates offspring with ` +
        `screen "none": discarding the surplus unscreened is a random cull, ` +
        `not pre-selection. Name a screen, or leave ratio at 1.`,
      "CROSS_FIELD_VALIDATION",
    );
  }
  if (resolved.ratio === 1 && resolved.screen !== "none") {
    throw new ConfigurationError(
      `preSelection.screen ${JSON.stringify(resolved.screen)} has nothing to ` +
        `screen at ratio 1 — no surplus is bred, so no candidate can be ` +
        `rejected. Raise the ratio, or leave the screen at "none".`,
      "CROSS_FIELD_VALIDATION",
    );
  }
  return resolved;
}

/** Reject a field that is not a finite integer at or above `min`. */
function assertInteger(field: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ConfigurationError(
      `preSelection.${field} must be an integer >= ${min}, got ${value}`,
      value === Math.trunc(value) ? "OUT_OF_RANGE" : "NOT_INTEGER",
    );
  }
}
