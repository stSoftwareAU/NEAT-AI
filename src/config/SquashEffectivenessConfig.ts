/**
 * SquashEffectivenessConfig.ts - Configuration for fitness-driven squash
 * mutation (Issue #2457).
 *
 * Biases squash-function mutation toward activations that have historically
 * improved fitness in similar neuron roles. A "role" is a stable bucket
 * derived from layer index (input-adjacent / mid / output-adjacent) plus
 * fan-in bucket (low / medium / high), so squash mutation explores
 * promising options first instead of sampling uniformly.
 */

/**
 * Configuration for the per-role squash effectiveness tracker.
 */
export interface SquashEffectivenessConfig {
  /** Whether the tracker biases squash mutation (default: true). */
  enabled?: boolean;

  /**
   * Minimum samples a role must have accumulated before its histogram is used
   * to bias selection. Below this threshold, sampling falls back to uniform
   * (default: 20).
   */
  minSamples?: number;

  /**
   * Fraction of biased draws that are forced to uniform sampling so the
   * search continues to explore under-sampled squashes (default: 0.2).
   * Range 0..1 inclusive.
   */
  explorationWeight?: number;

  /**
   * Exponential moving average smoothing factor applied to fitness deltas
   * (default: 0.2). Range (0, 1]. Larger values weight recent samples more.
   */
  emaAlpha?: number;

  /**
   * Inverse-temperature multiplier applied to the EMA before the Boltzmann
   * exponent (default: 25). Larger values concentrate biased draws on the
   * highest-EMA squash; smaller values keep the distribution flatter.
   * Production fitness deltas are typically small in magnitude, so the
   * default is large enough that even +0.1 EMA against 0 produces a strong
   * preference (matching the example in Issue #2457).
   */
  boltzmannBeta?: number;

  /**
   * Strict upper bound for the "low" fan-in bucket (default: 3). Neurons
   * with fan-in `< fanInLowThreshold` map to the low bucket.
   */
  fanInLowThreshold?: number;

  /**
   * Strict lower bound for the "high" fan-in bucket (default: 8). Neurons
   * with fan-in `>= fanInHighThreshold` map to the high bucket; everything
   * in between is "medium".
   */
  fanInHighThreshold?: number;
}

/**
 * Required version of SquashEffectivenessConfig with all fields populated.
 */
export type RequiredSquashEffectivenessConfig = Required<
  SquashEffectivenessConfig
>;

/**
 * Default values for the squash effectiveness tracker.
 */
export const DEFAULT_SQUASH_EFFECTIVENESS_CONFIG:
  RequiredSquashEffectivenessConfig = {
    enabled: true,
    minSamples: 20,
    explorationWeight: 0.2,
    emaAlpha: 0.2,
    boltzmannBeta: 25,
    fanInLowThreshold: 3,
    fanInHighThreshold: 8,
  };
