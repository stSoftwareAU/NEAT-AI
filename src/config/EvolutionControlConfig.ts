/**
 * Evolution-control (model management) configuration — Issue #3931.
 *
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) §4 argues that the part of
 * surrogate-assisted evolution which decides whether the method works is not
 * the cheap evaluator but the **policy** around it: which individuals earn the
 * true fitness, which get the approximation, and how that split adapts as the
 * search proceeds. This is the configuration of that policy.
 *
 * **Off by default (`strategy: "none"`).** With the default, every creature is
 * evaluated exactly every generation — the behaviour of every build before this
 * one — and nothing here is consulted beyond the invariant guards. See
 * [`docs/EVOLUTION_CONTROL.md`](../../docs/EVOLUTION_CONTROL.md).
 *
 * @module EvolutionControlConfig
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";

/**
 * The evolution-control strategies of Jin (2011) §4 this repository implements.
 *
 * `"population"` — separate sub-populations at separate fidelities — is not
 * offered: it needs an island model the evolution loop does not have, and
 * pretending to offer it would be worse than not offering it.
 */
export type EvolutionControlStrategy =
  /** Today's behaviour: every creature exact, every generation. */
  | "none"
  /** Generation-based control: an exact sweep every `exactEvery` generations. */
  | "generation"
  /** Individual-based control: cheap sweep, exact for the top-k plus a spread. */
  | "individual";

/** Every strategy name, for validation and for callers enumerating them. */
export const EVOLUTION_CONTROL_STRATEGIES: readonly EvolutionControlStrategy[] =
  Object.freeze(["none", "generation", "individual"]);

/** Caller-supplied evolution-control options; every field is optional. */
export interface EvolutionControlConfig {
  /**
   * Which evolution-control strategy runs.
   *
   * Default: `"none"` — exact evaluation everywhere, as before Issue #3931.
   */
  strategy?: EvolutionControlStrategy;
  /**
   * Generation-based control: run an exact sweep every λth generation.
   *
   * Default: `5`. Must be an integer `>= 2` — `1` would mean "exact every
   * generation", which is `"none"` spelt expensively.
   */
  exactEvery?: number;
  /**
   * Individual-based control: how many best-predicted creatures are
   * re-evaluated exactly each generation.
   *
   * Default: `2`. Must be an integer `>= 1`; the elite band is always exact
   * regardless, so this is the *additional* guarantee, not the only one.
   */
  exactTopK?: number;
  /**
   * Individual-based control: how many creatures are drawn from across the
   * cheap ordering — Jin's "diverse or uncertain sample" — on top of the top-k.
   *
   * Default: `2`. Must be an integer `>= 0`. Drawn on a deterministic stride so
   * a same-seed A/B is reproducible.
   */
  diverseSampleSize?: number;
  /**
   * False-optimum canary: the ordering divergence, in `[0, 1]`, above which the
   * cheap path is abandoned for the rest of the run.
   *
   * Divergence is the fraction of creature pairs the cheap ordering placed the
   * other way round from the exact one, measured on each exact sweep. Default:
   * `0.25` — a quarter of all pairs inverted is well past the point where the
   * cheap ordering carries selection.
   */
  canaryThreshold?: number;
  /**
   * False-optimum canary: how many consecutive exact sweeps must show a
   * strictly widening divergence before the cheap path is abandoned, even while
   * every reading is still under `canaryThreshold`.
   *
   * Jin's warning is about the *trend*, not the level: a divergence that climbs
   * every anchor is the search optimising the model's error. Default: `3`. Must
   * be an integer `>= 2`.
   */
  canaryWindow?: number;
}

/** Fully resolved evolution-control configuration used internally. */
export interface RequiredEvolutionControlConfig {
  strategy: EvolutionControlStrategy;
  exactEvery: number;
  exactTopK: number;
  diverseSampleSize: number;
  canaryThreshold: number;
  canaryWindow: number;
}

/** Policy off; the remaining values are the defaults a strategy would use. */
export const DEFAULT_EVOLUTION_CONTROL_CONFIG: Readonly<
  RequiredEvolutionControlConfig
> = Object.freeze({
  strategy: "none" as EvolutionControlStrategy,
  exactEvery: 5,
  exactTopK: 2,
  diverseSampleSize: 2,
  canaryThreshold: 0.25,
  canaryWindow: 3,
});

/**
 * Layer caller overrides over {@link DEFAULT_EVOLUTION_CONTROL_CONFIG}.
 *
 * Invalid values are **rejected, never clamped**. A silently corrected
 * `exactEvery` would change how often the search re-anchors on ground truth
 * without saying so, which is precisely the quiet damage Issue #3931 exists to
 * prevent.
 *
 * @param overrides - Partial caller options, or `undefined` for the defaults.
 * @returns The resolved configuration.
 * @throws {ConfigurationError} When a field is present but invalid.
 */
export function resolveEvolutionControlConfig(
  overrides?: EvolutionControlConfig,
): RequiredEvolutionControlConfig {
  const resolved: RequiredEvolutionControlConfig = {
    strategy: overrides?.strategy ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.strategy,
    exactEvery: overrides?.exactEvery ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.exactEvery,
    exactTopK: overrides?.exactTopK ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.exactTopK,
    diverseSampleSize: overrides?.diverseSampleSize ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.diverseSampleSize,
    canaryThreshold: overrides?.canaryThreshold ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.canaryThreshold,
    canaryWindow: overrides?.canaryWindow ??
      DEFAULT_EVOLUTION_CONTROL_CONFIG.canaryWindow,
  };

  if (!EVOLUTION_CONTROL_STRATEGIES.includes(resolved.strategy)) {
    throw new ConfigurationError(
      `evolutionControl.strategy must be one of ` +
        `${EVOLUTION_CONTROL_STRATEGIES.join(", ")}, got ` +
        `${JSON.stringify(resolved.strategy)}`,
      "INVALID_TYPE",
    );
  }
  assertInteger("exactEvery", resolved.exactEvery, 2);
  assertInteger("exactTopK", resolved.exactTopK, 1);
  assertInteger("diverseSampleSize", resolved.diverseSampleSize, 0);
  assertInteger("canaryWindow", resolved.canaryWindow, 2);
  if (
    !Number.isFinite(resolved.canaryThreshold) ||
    resolved.canaryThreshold <= 0 || resolved.canaryThreshold > 1
  ) {
    throw new ConfigurationError(
      `evolutionControl.canaryThreshold must be in (0, 1], got ` +
        `${resolved.canaryThreshold}`,
      "OUT_OF_RANGE",
    );
  }
  return resolved;
}

/** Reject a field that is not a finite integer at or above `min`. */
function assertInteger(field: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ConfigurationError(
      `evolutionControl.${field} must be an integer >= ${min}, got ${value}`,
      value === Math.trunc(value) ? "OUT_OF_RANGE" : "NOT_INTEGER",
    );
  }
}
