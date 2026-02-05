/**
 * Tracks mutation stability metrics per creature.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * This module provides mechanisms to track the success rate of mutations,
 * distinguishing between:
 * - STABLE: Mutation passed validation and produces consistent results
 * - BRITTLE: Mutation passed validation but shows inconsistency (e.g., score variance)
 * - FAILED: Mutation failed validation entirely
 *
 * These metrics are used to adaptively adjust mutation rates and strategies.
 */

/**
 * Possible outcomes of a mutation attempt.
 */
export enum MutationOutcome {
  /** Mutation passed validation and produces consistent results. */
  STABLE = "STABLE",
  /** Mutation passed validation but shows inconsistency across validation sets. */
  BRITTLE = "BRITTLE",
  /** Mutation failed validation entirely. */
  FAILED = "FAILED",
}

/**
 * Configuration for stability tracking behaviour.
 */
export interface StabilityConfig {
  /**
   * Number of recent mutations to consider when calculating stability metrics.
   * A larger window is more stable but slower to adapt.
   * Default: 20
   */
  windowSize: number;

  /**
   * Brittleness rate threshold above which a creature is considered brittle.
   * For example, 0.3 means 30% brittle mutations triggers adaptation.
   * Default: 0.3
   */
  brittlenessThreshold: number;

  /**
   * Whether to track stability metrics per mutation type (e.g., MOD_WEIGHT, ADD_NODE).
   * Default: false
   */
  trackPerType?: boolean;

  /**
   * Score variance threshold for automatically classifying mutations as brittle.
   * When the absolute difference between training and validation scores exceeds
   * this fraction, the mutation is classified as brittle.
   * Default: 0.1 (10%)
   */
  scoreVarianceThreshold?: number;

  /**
   * Factor by which to reduce mutation magnitude for brittle creatures.
   * Applied when brittleness rate exceeds the threshold.
   * Value between 0 and 1.
   * Default: 0.5
   */
  magnitudeReductionFactor?: number;

  /**
   * Factor by which to boost mutation magnitude for stable creatures.
   * Applied when stability rate is very high.
   * Value greater than 1.
   * Default: 1.2
   */
  magnitudeBoostFactor?: number;
}

/**
 * Stability metrics computed from recent mutation history.
 */
export interface StabilityMetrics {
  /** Total number of mutations in the current window. */
  totalMutations: number;
  /** Number of stable mutations. */
  stableCount: number;
  /** Number of brittle mutations. */
  brittleCount: number;
  /** Number of failed mutations. */
  failedCount: number;
  /** Fraction of mutations that were stable (0 to 1). */
  stabilityRate: number;
  /** Fraction of mutations that were brittle (0 to 1). */
  brittlenessRate: number;
}

/**
 * Recorded mutation outcome with optional scores.
 */
interface MutationRecord {
  outcome: MutationOutcome;
  mutationType?: string;
  trainingScore?: number;
  validationScore?: number;
  timestamp: number;
}

/**
 * Tracks mutation stability metrics for adaptive mutation rate adjustment.
 *
 * This class maintains a rolling window of mutation outcomes and computes
 * stability metrics that can be used to adjust mutation strategies.
 *
 * @example
 * ```ts
 * const tracker = new MutationStabilityTracker({
 *   windowSize: 20,
 *   brittlenessThreshold: 0.3,
 * });
 *
 * // Record outcomes during evolution
 * tracker.recordOutcome(MutationOutcome.STABLE);
 * tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
 *
 * // Check if creature is producing brittle offspring
 * if (tracker.isBrittle()) {
 *   const multiplier = tracker.getMutationMagnitudeMultiplier();
 *   // Apply reduced mutation magnitude
 * }
 * ```
 */
export class MutationStabilityTracker {
  private readonly config: StabilityConfig;
  private history: MutationRecord[] = [];
  private perTypeHistory: Map<string, MutationRecord[]> = new Map();

  /**
   * Creates a new MutationStabilityTracker with the given configuration.
   *
   * @param config - Stability tracking configuration
   */
  constructor(config: StabilityConfig) {
    this.config = {
      scoreVarianceThreshold: 0.1,
      magnitudeReductionFactor: 0.5,
      magnitudeBoostFactor: 1.2,
      trackPerType: false,
      ...config,
    };
  }

  /**
   * Records a mutation outcome.
   *
   * @param outcome - The outcome of the mutation
   * @param mutationType - Optional mutation type name (e.g., "MOD_WEIGHT", "ADD_NODE")
   */
  recordOutcome(outcome: MutationOutcome, mutationType?: string): void {
    const record: MutationRecord = {
      outcome,
      mutationType,
      timestamp: Date.now(),
    };

    this.addRecord(record);
  }

  /**
   * Records a mutation outcome with training and validation scores.
   *
   * The outcome may be reclassified as BRITTLE if the score variance exceeds
   * the configured threshold.
   *
   * @param outcome - The initial outcome of the mutation
   * @param trainingScore - Score on training data
   * @param validationScore - Score on validation data
   * @param mutationType - Optional mutation type name
   */
  recordOutcomeWithScores(
    outcome: MutationOutcome,
    trainingScore: number,
    validationScore: number,
    mutationType?: string,
  ): void {
    let finalOutcome = outcome;

    // Check for brittleness based on score variance
    if (
      outcome === MutationOutcome.STABLE &&
      this.config.scoreVarianceThreshold !== undefined
    ) {
      const variance = Math.abs(trainingScore - validationScore);
      const baseline = Math.max(Math.abs(trainingScore), 0.0001);
      const varianceRate = variance / baseline;

      if (varianceRate > this.config.scoreVarianceThreshold) {
        finalOutcome = MutationOutcome.BRITTLE;
      }
    }

    const record: MutationRecord = {
      outcome: finalOutcome,
      mutationType,
      trainingScore,
      validationScore,
      timestamp: Date.now(),
    };

    this.addRecord(record);
  }

  /**
   * Adds a record to the history and maintains the window size.
   */
  private addRecord(record: MutationRecord): void {
    this.history.push(record);

    // Maintain window size
    if (this.history.length > this.config.windowSize) {
      this.history = this.history.slice(-this.config.windowSize);
    }

    // Track per-type if enabled
    if (this.config.trackPerType && record.mutationType) {
      const typeHistory = this.perTypeHistory.get(record.mutationType) ?? [];
      typeHistory.push(record);

      // Maintain window size per type
      if (typeHistory.length > this.config.windowSize) {
        this.perTypeHistory.set(
          record.mutationType,
          typeHistory.slice(-this.config.windowSize),
        );
      } else {
        this.perTypeHistory.set(record.mutationType, typeHistory);
      }
    }
  }

  /**
   * Gets the current stability metrics.
   *
   * @returns Stability metrics computed from the current window
   */
  getMetrics(): StabilityMetrics {
    return this.computeMetrics(this.history);
  }

  /**
   * Gets stability metrics for a specific mutation type.
   *
   * @param mutationType - The mutation type to get metrics for
   * @returns Stability metrics for the specified type
   */
  getMetricsForType(mutationType: string): StabilityMetrics {
    const typeHistory = this.perTypeHistory.get(mutationType) ?? [];
    return this.computeMetrics(typeHistory);
  }

  /**
   * Computes metrics from a history array.
   */
  private computeMetrics(records: MutationRecord[]): StabilityMetrics {
    const total = records.length;

    if (total === 0) {
      return {
        totalMutations: 0,
        stableCount: 0,
        brittleCount: 0,
        failedCount: 0,
        stabilityRate: 1.0, // Default to optimistic (stable)
        brittlenessRate: 0.0,
      };
    }

    let stableCount = 0;
    let brittleCount = 0;
    let failedCount = 0;

    for (const record of records) {
      switch (record.outcome) {
        case MutationOutcome.STABLE:
          stableCount++;
          break;
        case MutationOutcome.BRITTLE:
          brittleCount++;
          break;
        case MutationOutcome.FAILED:
          failedCount++;
          break;
      }
    }

    return {
      totalMutations: total,
      stableCount,
      brittleCount,
      failedCount,
      stabilityRate: stableCount / total,
      brittlenessRate: brittleCount / total,
    };
  }

  /**
   * Checks if the creature is considered brittle based on recent mutations.
   *
   * @returns true if brittleness rate exceeds the threshold
   */
  isBrittle(): boolean {
    const metrics = this.getMetrics();
    return metrics.brittlenessRate >= this.config.brittlenessThreshold;
  }

  /**
   * Gets a mutation magnitude multiplier based on stability.
   *
   * - For brittle creatures: Returns a value < 1 (reduced magnitude)
   * - For stable creatures: Returns a value > 1 (increased exploration)
   * - For neutral: Returns 1.0
   *
   * @returns Multiplier to apply to mutation magnitude
   */
  getMutationMagnitudeMultiplier(): number {
    const metrics = this.getMetrics();

    if (metrics.totalMutations === 0) {
      return 1.0;
    }

    // Brittle: Reduce magnitude to make smaller, safer changes
    if (metrics.brittlenessRate >= this.config.brittlenessThreshold) {
      // Scale reduction based on how brittle
      const excessBrittleness = metrics.brittlenessRate -
        this.config.brittlenessThreshold;
      const maxExcess = 1.0 - this.config.brittlenessThreshold;
      const brittlenessRatio = Math.min(excessBrittleness / maxExcess, 1.0);

      const reductionFactor = this.config.magnitudeReductionFactor ?? 0.5;
      // Interpolate from 1.0 to reductionFactor based on brittleness
      return 1.0 - brittlenessRatio * (1.0 - reductionFactor);
    }

    // Very stable: Boost exploration
    const stableThreshold = 0.8; // 80% stable to get boost
    if (metrics.stabilityRate >= stableThreshold) {
      const boostFactor = this.config.magnitudeBoostFactor ?? 1.2;
      // Scale boost based on how stable
      const stabilityRatio = (metrics.stabilityRate - stableThreshold) /
        (1.0 - stableThreshold);
      return 1.0 + stabilityRatio * (boostFactor - 1.0);
    }

    return 1.0;
  }

  /**
   * Gets a normalised stability score (0 = very unstable, 1 = very stable).
   *
   * This score factors in both the stability rate and the inverse of brittleness,
   * penalising failures more than brittleness.
   *
   * @returns Normalised stability score between 0 and 1
   */
  getStabilityScore(): number {
    const metrics = this.getMetrics();

    if (metrics.totalMutations === 0) {
      return 1.0; // Default to optimistic
    }

    // Weight: stable = 1.0, brittle = 0.3, failed = 0.0
    const weightedSum = metrics.stableCount * 1.0 +
      metrics.brittleCount * 0.3 +
      metrics.failedCount * 0.0;

    return weightedSum / metrics.totalMutations;
  }

  /**
   * Resets all tracking history.
   */
  reset(): void {
    this.history = [];
    this.perTypeHistory.clear();
  }
}
