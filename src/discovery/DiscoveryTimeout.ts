/**
 * Adaptive discovery timeout based on creature complexity.
 *
 * Calculates an appropriate recording-phase timeout that scales
 * logarithmically with the creature's neuron and synapse counts.
 * Simple creatures get shorter timeouts (faster stuck-discovery recovery),
 * while complex creatures are allowed more time.
 *
 * @module
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/1298
 */

export interface DiscoveryTimeoutBounds {
  /** Minimum timeout in minutes. */
  minTimeoutMinutes: number;
  /** Maximum timeout in minutes. */
  maxTimeoutMinutes: number;
}

/**
 * Default bounds: 0.5 minutes (30 seconds) minimum, 10 minutes maximum.
 * These match the issue specification.
 */
export const DEFAULT_DISCOVERY_TIMEOUT_BOUNDS: Readonly<
  DiscoveryTimeoutBounds
> = Object.freeze({
  minTimeoutMinutes: 0.5,
  maxTimeoutMinutes: 10,
});

export interface CreatureComplexityInput {
  /** Total number of neurons (input + hidden + output). */
  neuronCount: number;
  /** Total number of synapses (connections). */
  synapseCount: number;
}

/**
 * Calculates an adaptive discovery timeout based on creature complexity.
 *
 * The complexity score combines neuron count and synapse count using a
 * logarithmic scale so that timeout grows slowly as networks become larger.
 *
 * Formula: `timeout = min + (max - min) * log(1 + complexity) / log(1 + referenceComplexity)`
 *
 * Where `complexity = neurons * log(synapses + 1)` and `referenceComplexity`
 * is the complexity level at which the timeout reaches its maximum.
 *
 * @param input - Neuron and synapse counts of the creature.
 * @param bounds - Optional min/max timeout bounds (defaults to 0.5–10 minutes).
 * @returns Timeout in minutes, clamped to [min, max].
 */
export function calculateDiscoveryTimeout(
  input: CreatureComplexityInput,
  bounds?: DiscoveryTimeoutBounds,
): number {
  const { minTimeoutMinutes, maxTimeoutMinutes } = bounds ??
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS;

  const neurons = Math.max(0, input.neuronCount);
  const synapses = Math.max(0, input.synapseCount);

  // Complexity score: neurons weighted by log of synapses.
  // This reflects that more synapses per neuron means more analysis work.
  const complexity = neurons * Math.log(synapses + 1);

  // Reference complexity at which timeout reaches maximum.
  // ~1000 neurons with ~10k synapses → complexity ≈ 1000 * ln(10001) ≈ 9210.
  const referenceComplexity = 1000 * Math.log(10_001);

  // Logarithmic scaling: grow slowly towards maximum.
  const fraction = Math.log(1 + complexity) / Math.log(1 + referenceComplexity);
  const clampedFraction = Math.min(1, Math.max(0, fraction));

  const range = maxTimeoutMinutes - minTimeoutMinutes;
  const timeout = minTimeoutMinutes + range * clampedFraction;

  return Math.min(maxTimeoutMinutes, Math.max(minTimeoutMinutes, timeout));
}
