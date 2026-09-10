/**
 * @module
 *
 * Options for the targeted skip-connection operator (Issue #3973).
 *
 * `AddConnection` draws a source and a target uniformly, so the chance of a
 * single draw straddling one specific deep chain is negligible — measured on
 * `test/data/grq-23-forests-constants.json` in #3972, the 28-neuron tail from
 * depth 34 to 61 carries no bypass at all while the output neuron has fan-in
 * 325. `AddSkipConnection` proposes that bypass deliberately.
 *
 * Both fields default to the current behaviour: `skipConnectionRate: 0` means
 * the operator is never selected, so an unset config is identical to a build
 * without this feature.
 */
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import {
  DEFAULT_STRUCTURAL_MUTATION_OPTIONS,
  resolveStructuralMutationOptions,
  type StructuralMutationOptions,
} from "@mutate/StructuralMutationOptions.ts";

/**
 * Caller-supplied options for {@link AddSkipConnection}. Every field is
 * optional; `structuralWeightScale` is inherited from #3970 because a bypass
 * around a tuned chain is the same perturbation that issue describes.
 */
export interface SkipConnectionOptions extends StructuralMutationOptions {
  /**
   * Shortest serial run worth bypassing, counted in hidden neurons. A run of
   * `n` members places the bypass around the `n - 1` members downstream of the
   * entry neuron, so `2` is the smallest value that skips anything.
   */
  skipMinRunLength?: number;
}

/** Default shortest run considered worth bypassing. */
export const DEFAULT_SKIP_MIN_RUN_LENGTH = 4;

/** A bypass must skip at least one neuron, so a run needs at least two. */
export const MINIMUM_SKIP_MIN_RUN_LENGTH = 2;

/** Skip-connection options with every default resolved. */
export interface ResolvedSkipConnectionOptions {
  /** Scale passed to `Synapse.randomWeight()` for the bypass synapse. */
  structuralWeightScale: number;
  /** Shortest serial run considered worth bypassing. */
  skipMinRunLength: number;
}

/** The resolved defaults: #3970's full random weight, and a run of four. */
export const DEFAULT_SKIP_CONNECTION_OPTIONS: ResolvedSkipConnectionOptions = {
  structuralWeightScale:
    DEFAULT_STRUCTURAL_MUTATION_OPTIONS.structuralWeightScale,
  skipMinRunLength: DEFAULT_SKIP_MIN_RUN_LENGTH,
};

/**
 * Validates caller-supplied skip options and fills in the defaults.
 *
 * @param options - Partial options, or `undefined` for the defaults.
 * @returns The resolved options.
 * @throws {ConfigurationError} When a supplied value is out of range.
 */
export function resolveSkipConnectionOptions(
  options?: SkipConnectionOptions,
): ResolvedSkipConnectionOptions {
  if (!options) return DEFAULT_SKIP_CONNECTION_OPTIONS;

  // #3970 owns `structuralWeightScale`, including its range check and the
  // wording of the error — delegate rather than keep a second copy in step.
  const { structuralWeightScale } = resolveStructuralMutationOptions({
    structuralWeightScale: options.structuralWeightScale,
  });

  const minRunLength = options.skipMinRunLength ??
    DEFAULT_SKIP_CONNECTION_OPTIONS.skipMinRunLength;
  if (!Number.isInteger(minRunLength)) {
    throw new ConfigurationError(
      `skipMinRunLength must be a whole number, was ${minRunLength}`,
      "NOT_INTEGER",
    );
  }
  if (minRunLength < MINIMUM_SKIP_MIN_RUN_LENGTH) {
    throw new ConfigurationError(
      `skipMinRunLength must be at least ${MINIMUM_SKIP_MIN_RUN_LENGTH}, was ${minRunLength}`,
      "OUT_OF_RANGE",
    );
  }

  return { structuralWeightScale, skipMinRunLength: minRunLength };
}
