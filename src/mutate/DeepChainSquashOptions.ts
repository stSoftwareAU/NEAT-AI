/**
 * @module
 *
 * Options for the depth-aware squash bias (Issue #3974).
 *
 * #3972 measured the mechanism this bias answers: on
 * `test/data/grq-23-forests-constants.json` the depth-34→61 tail is a 28-neuron
 * single-file run built almost entirely from activations with an exactly-zero
 * derivative region, and one saturated member zeroes the gradient for every
 * member upstream of it. `ModSquash` draws its replacement squash from a pool
 * that is blind to that structure.
 *
 * The knob is deliberately **a bias, not a ban**: removing `HARD_TANH`, `IF`,
 * `MINIMUM` and `MAXIMUM` from the pool at depth would shrink the search space
 * in a way NEAT cannot recover from, and those activations are load-bearing
 * elsewhere in the creature. Existing neurons are never rewritten — this
 * governs what a new mutation proposes.
 *
 * `deepChainSquashBias: 0` — the default — consumes no extra randomness and
 * runs no extra topology scan, so a build with this feature is bit-identical
 * to one without it on a fixed seed.
 */
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import {
  DEFAULT_SKIP_MIN_RUN_LENGTH,
  MINIMUM_SKIP_MIN_RUN_LENGTH,
} from "@mutate/SkipConnectionOptions.ts";

/** Caller-supplied options for the depth-aware squash bias. */
export interface DeepChainSquashOptions {
  /**
   * Strength of the down-weighting applied to gradient-blocking activations
   * when the neuron being re-squashed sits inside a long serial run. `0`
   * disables the bias; `1` re-draws every blocking proposal once. Range
   * `[0, 1]`.
   */
  deepChainSquashBias?: number;

  /**
   * Run length, counted in chain members, at which the bias starts applying.
   * Shares its default and its floor with #3973's `skipMinRunLength`, because
   * both operators mean the same thing by "a run worth acting on".
   */
  deepChainMinLength?: number;
}

/** Default bias strength: disabled, so behaviour is unchanged. */
export const DEFAULT_DEEP_CHAIN_SQUASH_BIAS = 0;

/**
 * Default run length at which the bias applies — #3973's
 * `DEFAULT_SKIP_MIN_RUN_LENGTH`, shared rather than copied.
 */
export const DEFAULT_DEEP_CHAIN_MIN_LENGTH = DEFAULT_SKIP_MIN_RUN_LENGTH;

/** Shortest run the bias will consider — #3973's floor, shared. */
export const MINIMUM_DEEP_CHAIN_MIN_LENGTH = MINIMUM_SKIP_MIN_RUN_LENGTH;

/** Depth-aware squash bias options with every default resolved. */
export interface ResolvedDeepChainSquashOptions {
  /** Strength of the down-weighting; `0` disables the bias entirely. */
  deepChainSquashBias: number;
  /** Run length at which the bias starts applying. */
  deepChainMinLength: number;
}

/** The resolved defaults: no bias, and #3973's run length of four. */
export const DEFAULT_DEEP_CHAIN_SQUASH_OPTIONS: ResolvedDeepChainSquashOptions =
  {
    deepChainSquashBias: DEFAULT_DEEP_CHAIN_SQUASH_BIAS,
    deepChainMinLength: DEFAULT_DEEP_CHAIN_MIN_LENGTH,
  };

/**
 * Validates caller-supplied bias options and fills in the defaults.
 *
 * @param options - Partial options, or `undefined` for the defaults.
 * @returns The resolved options.
 * @throws {ConfigurationError} When a supplied value is out of range.
 */
export function resolveDeepChainSquashOptions(
  options?: DeepChainSquashOptions,
): ResolvedDeepChainSquashOptions {
  if (!options) return DEFAULT_DEEP_CHAIN_SQUASH_OPTIONS;

  const bias = options.deepChainSquashBias ??
    DEFAULT_DEEP_CHAIN_SQUASH_BIAS;
  if (!Number.isFinite(bias)) {
    throw new ConfigurationError(
      `deepChainSquashBias must be a finite number, was ${bias}`,
      "NOT_FINITE",
    );
  }
  if (bias < 0 || bias > 1) {
    throw new ConfigurationError(
      `deepChainSquashBias must be between 0 and 1, was ${bias}`,
      "OUT_OF_RANGE",
    );
  }

  const minLength = options.deepChainMinLength ??
    DEFAULT_DEEP_CHAIN_MIN_LENGTH;
  if (!Number.isInteger(minLength)) {
    throw new ConfigurationError(
      `deepChainMinLength must be a whole number, was ${minLength}`,
      "NOT_INTEGER",
    );
  }
  if (minLength < MINIMUM_DEEP_CHAIN_MIN_LENGTH) {
    throw new ConfigurationError(
      `deepChainMinLength must be at least ${MINIMUM_DEEP_CHAIN_MIN_LENGTH}, was ${minLength}`,
      "OUT_OF_RANGE",
    );
  }

  return { deepChainSquashBias: bias, deepChainMinLength: minLength };
}
