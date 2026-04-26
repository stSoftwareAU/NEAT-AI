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

/**
 * The minimum total wall-clock budget (recording + analysis) we allow
 * for any single discovery, in minutes. Below this we still allocate
 * ~half to recording and ~half to analysis so each phase has a chance
 * to make progress, but the *total* never exceeds the caller's budget.
 *
 * Issue #2432.
 */
export const DISCOVERY_MIN_PHASE_MINUTES = 0.5; // 30 seconds

export interface DiscoveryTimeoutAllocationInput {
  /** Wall-clock minutes still available to the caller. */
  wallClockMinutes: number;
  /** Configured recording timeout cap (`config.discoveryRecordTimeOutMinutes`). */
  configuredRecordMinutes: number;
  /** Configured analysis timeout cap (`config.discoveryAnalysisTimeoutMinutes`). */
  configuredAnalysisMinutes: number;
  /** Adaptive ceiling for the recording phase derived from creature complexity. */
  adaptiveRecordMinutes: number;
}

export interface DiscoveryTimeoutAllocation {
  /** Effective recording-phase timeout in minutes. */
  recordMinutes: number;
  /** Effective analysis-phase timeout in minutes. */
  analysisMinutes: number;
  /** Total of recording + analysis (must not exceed wallClockMinutes). */
  totalMinutes: number;
}
/**
 * Allocates a single discovery's wall-clock budget between the recording
 * and analysis phases so that the **total** never exceeds the caller's
 * remaining wall-clock budget (Issue #2432).
 *
 * The previous behaviour was to allow recording to consume up to
 * `wallClockMinutes` and **then** add `configuredAnalysisMinutes` (default
 * 10) on top — which silently doubled, or worse, the caller's request.
 *
 * Allocation rules:
 *  - Both phases get at least {@link DISCOVERY_MIN_PHASE_MINUTES} when the
 *    wall-clock budget allows it.
 *  - Recording is capped by {@link adaptiveRecordMinutes} and
 *    {@link configuredRecordMinutes}.
 *  - Analysis is capped by {@link configuredAnalysisMinutes}.
 *  - The remaining slack (after recording is allocated) flows to analysis,
 *    so the sum of `recordMinutes + analysisMinutes` is always ≤
 *    `wallClockMinutes`.
 */
export function allocateDiscoveryTimeouts(
  input: DiscoveryTimeoutAllocationInput,
): DiscoveryTimeoutAllocation {
  const wallClock = Math.max(0, input.wallClockMinutes);
  const recordCap = Math.min(
    Math.max(0, input.configuredRecordMinutes),
    Math.max(0, input.adaptiveRecordMinutes),
  );
  const analysisCap = Math.max(0, input.configuredAnalysisMinutes);

  // Degenerate budget: nothing to allocate.
  if (wallClock <= 0) {
    return { recordMinutes: 0, analysisMinutes: 0, totalMinutes: 0 };
  }

  const phaseMin = DISCOVERY_MIN_PHASE_MINUTES;

  // When the wall-clock budget can't afford even one minimum-sized phase
  // for each, split it 50/50 (still bounded by the configured/adaptive caps).
  if (wallClock < phaseMin * 2) {
    const half = wallClock / 2;
    const recordMinutes = Math.min(recordCap, half);
    const analysisMinutes = Math.min(analysisCap, wallClock - recordMinutes);
    return {
      recordMinutes,
      analysisMinutes,
      totalMinutes: recordMinutes + analysisMinutes,
    };
  }

  // Reserve at least the minimum analysis slice so that recording never
  // monopolises the entire budget.
  const recordMinutes = Math.max(
    phaseMin,
    Math.min(recordCap, wallClock - phaseMin),
  );
  const analysisMinutes = Math.max(
    phaseMin,
    Math.min(analysisCap, wallClock - recordMinutes),
  );

  return {
    recordMinutes,
    analysisMinutes,
    totalMinutes: recordMinutes + analysisMinutes,
  };
}
