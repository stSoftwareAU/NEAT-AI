/**
 * Configuration for adaptive mutation rate based on creature size.
 *
 * Issue #1037: Implement adaptive mutation rate for large creatures.
 *
 * Large creatures have a massive search space. Adding more structure
 * (ADD_NODE, ADD_CONNECTION) makes the search space exponentially larger
 * while rarely improving fitness. This configuration allows fine-tuning
 * the mutation behaviour based on creature size.
 */
export interface AdaptiveMutationThresholds {
  /**
   * Neuron count threshold for medium creatures.
   * Creatures with >= medium neurons will have reduced topology expansion mutations.
   * Default: 100
   */
  medium?: number;

  /**
   * Neuron count threshold for large creatures.
   * Creatures with >= large neurons will heavily favour weight/bias mutations.
   * Must be greater than the medium threshold.
   * Default: 300
   */
  large?: number;

  /**
   * Weight factor for topology mutations (ADD_NODE, ADD_CONN) for large creatures.
   * Value between 0 and 1:
   * - 0: Completely disable topology expansion for large creatures
   * - 0.1 (default): 10% chance of topology mutation for large creatures
   * - 1: Normal topology mutation rates (no reduction)
   * Default: 0.1
   */
  largeTopologyWeight?: number;
}

/**
 * Required version of AdaptiveMutationThresholds with all fields populated.
 * Used internally after defaults are applied.
 */
export type RequiredAdaptiveMutationThresholds = Required<
  AdaptiveMutationThresholds
>;

/**
 * Default values for adaptive mutation thresholds.
 */
export const DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS:
  RequiredAdaptiveMutationThresholds = {
    medium: 100,
    large: 300,
    largeTopologyWeight: 0.1,
  };
