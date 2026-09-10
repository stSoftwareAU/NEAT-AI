/**
 * @module
 *
 * Identity-initialised structural mutation options (Issue #3970).
 *
 * `AddNeuron` and `AddConnection` inject a full random weight (uniform in
 * `[-0.5, +0.5]`) into an existing, tuned neuron's summed input. On a large
 * creature that is a large perturbation, and the offspring is overwhelmingly
 * likely to score below its parent. Scaling the **outward** synapse down
 * approaches the residual-block construction `x + εF(x)`: the new structure is
 * close to a no-op at birth, so it survives selection long enough for a
 * gradient step to learn a job for it.
 *
 * Both fields default to the historical behaviour, so an unset config is
 * bit-identical to a build without this feature.
 */
import { ConfigurationError } from "@errors/ConfigurationError.ts";

/** Caller-supplied structural mutation options; every field is optional. */
export interface StructuralMutationOptions {
  /**
   * Scale passed to `Synapse.randomWeight()` for the **outward** synapse of
   * `AddNeuron`, and for `AddConnection` on the main mutation path. `1`
   * (the default) reproduces the historical `[-0.5, +0.5]` draw.
   *
   * Only the outward synapse is scaled: the inward synapse merely determines
   * what the new neuron sees, while the outward synapse is what perturbs the
   * existing network. `Synapse.randomWeight()` enforces a minimum magnitude of
   * one plank (`1e-7`), so a reduced scale is never an exactly-zero weight —
   * a zero outward weight would give the whole inward subtree a zero gradient
   * and freeze the new neuron rather than merely quieten it.
   */
  structuralWeightScale?: number;

  /**
   * Compaction passes a newly inserted neuron is exempt from `compactUnused`
   * removal. `0` (the default) reproduces the historical behaviour, where a
   * near-identity neuron is the first candidate compaction deletes.
   */
  structuralNewbornGraceRounds?: number;
}

/** Structural mutation options with every default resolved. */
export type ResolvedStructuralMutationOptions = Required<
  StructuralMutationOptions
>;

/** Historical behaviour: full random weight, no newborn protection. */
export const DEFAULT_STRUCTURAL_MUTATION_OPTIONS:
  ResolvedStructuralMutationOptions = {
    structuralWeightScale: 1,
    structuralNewbornGraceRounds: 0,
  };

/**
 * Validates caller-supplied structural options and fills in the defaults.
 *
 * @param options - Partial options, or `undefined` for the defaults.
 * @returns The resolved options.
 * @throws {ConfigurationError} When a supplied value is out of range.
 */
export function resolveStructuralMutationOptions(
  options?: StructuralMutationOptions,
): ResolvedStructuralMutationOptions {
  if (!options) return DEFAULT_STRUCTURAL_MUTATION_OPTIONS;

  const scale = options.structuralWeightScale ??
    DEFAULT_STRUCTURAL_MUTATION_OPTIONS.structuralWeightScale;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new ConfigurationError(
      `structuralWeightScale must be a finite number greater than zero, was ${scale}`,
      "OUT_OF_RANGE",
    );
  }

  const graceRounds = options.structuralNewbornGraceRounds ??
    DEFAULT_STRUCTURAL_MUTATION_OPTIONS.structuralNewbornGraceRounds;
  if (!Number.isInteger(graceRounds) || graceRounds < 0) {
    throw new ConfigurationError(
      `structuralNewbornGraceRounds must be a non-negative integer, was ${graceRounds}`,
      Number.isInteger(graceRounds) ? "OUT_OF_RANGE" : "NOT_INTEGER",
    );
  }

  return {
    structuralWeightScale: scale,
    structuralNewbornGraceRounds: graceRounds,
  };
}
