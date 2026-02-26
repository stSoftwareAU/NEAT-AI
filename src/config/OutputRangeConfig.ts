/**
 * OutputRangeConfig.ts - Per-output range constraints for evolution.
 *
 * Issue #1620: Allow users to specify expected output ranges so creatures
 * that produce out-of-range outputs receive a configurable fitness penalty.
 */

/**
 * Defines a range constraint for a single output neuron.
 *
 * When specified, creatures whose outputs fall outside [min, max]
 * receive a fitness penalty proportional to the excess.
 */
export interface OutputRange {
  /** Minimum expected output value (inclusive). */
  min: number;
  /** Maximum expected output value (inclusive). */
  max: number;
  /** Penalty multiplier for out-of-range outputs (default: 1.0). */
  penaltyWeight?: number;
}

/**
 * Fully-resolved output range with all fields required.
 * Used internally after defaults have been applied.
 */
export type RequiredOutputRange = Required<OutputRange>;

/** Default penalty weight applied when not specified per range. */
export const DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT = 1.0;
