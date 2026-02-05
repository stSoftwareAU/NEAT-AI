/**
 * Ensemble diversity scoring for species management.
 *
 * Issue #1310: Reduce brittleness: Ensemble diversity scoring for species.
 *
 * This module provides diversity-aware species management to reduce reliance
 * on "brilliant but brittle" high-performers. It measures and encourages
 * diversity across species members using multiple metrics:
 *
 * - Weight variance: Variation in synapse weights across species members
 * - Squash entropy: Diversity of activation functions used
 * - Topology diversity: Variation in network structure
 *
 * Integration points:
 * - Fitness adjustment based on diversity contribution
 * - Protection of diverse low-performers from culling
 * - Cross-species breeding triggers when diversity is low
 * - Diverse parent pair preference during selection
 */

import type { Creature } from "../Creature.ts";
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type EnsembleDiversityConfig,
  type RequiredEnsembleDiversityConfig,
} from "../config/EnsembleDiversityConfig.ts";

// Re-export config types for consumers
export {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type EnsembleDiversityConfig,
  type RequiredEnsembleDiversityConfig,
};

/**
 * Metrics describing the diversity of a species.
 */
export interface SpeciesDiversityMetrics {
  /** Variance in synapse weights across species members */
  weightVariance: number;
  /** Entropy of activation function distribution */
  squashEntropy: number;
  /** Diversity in network topology (neuron/synapse counts) */
  topologyDiversity: number;
  /** Combined overall diversity score (0-1) */
  overallDiversity: number;
}

/**
 * Provides ensemble diversity scoring for species management.
 *
 * This class measures diversity within species and provides tools to
 * encourage diversity through fitness adjustment, culling protection,
 * and breeding recommendations.
 *
 * @example
 * ```ts
 * const scoring = new EnsembleDiversityScoring({
 *   enabled: true,
 *   diversityWeight: 0.2,
 * });
 *
 * // Calculate species diversity
 * const metrics = scoring.getSpeciesDiversityMetrics(speciesCreatures);
 *
 * // Adjust fitness based on diversity contribution
 * const adjustedFitness = scoring.getAdjustedFitness(
 *   creature.score,
 *   metrics.overallDiversity,
 * );
 * ```
 */
export class EnsembleDiversityScoring {
  private readonly config: RequiredEnsembleDiversityConfig;

  /**
   * Creates a new EnsembleDiversityScoring with the given configuration.
   *
   * @param config - Configuration options (defaults are applied)
   */
  constructor(config: EnsembleDiversityConfig) {
    this.config = {
      ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
      ...config,
    };
  }

  /**
   * Calculates the variance of synapse weights across creatures.
   *
   * Higher variance indicates more diverse weight distributions.
   *
   * @param creatures - Array of creatures to analyse
   * @returns Weight variance (0 = identical, higher = more diverse)
   */
  calculateWeightVariance(creatures: Creature[]): number {
    if (creatures.length < 2) {
      return 0;
    }

    // Collect all weights from all creatures
    const allWeights: number[] = [];
    for (const creature of creatures) {
      for (const synapse of creature.synapses) {
        if (Number.isFinite(synapse.weight)) {
          allWeights.push(synapse.weight);
        }
      }
      // Also include biases (skip input neurons which have Infinity bias)
      for (const neuron of creature.neurons) {
        if (neuron.type !== "input" && Number.isFinite(neuron.bias)) {
          allWeights.push(neuron.bias);
        }
      }
    }

    if (allWeights.length === 0) {
      return 0;
    }

    // Calculate variance
    const mean = allWeights.reduce((a, b) => a + b, 0) / allWeights.length;
    const variance =
      allWeights.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) /
      allWeights.length;

    return variance;
  }

  /**
   * Calculates the entropy of activation function distribution across creatures.
   *
   * Higher entropy indicates more diverse use of activation functions.
   * Uses Shannon entropy: H = -sum(p * log2(p))
   *
   * @param creatures - Array of creatures to analyse
   * @returns Squash function entropy (0 = all same, higher = more diverse)
   */
  calculateSquashEntropy(creatures: Creature[]): number {
    if (creatures.length < 2) {
      return 0;
    }

    // Count squash function occurrences
    const squashCounts = new Map<string, number>();
    let totalNeurons = 0;

    for (const creature of creatures) {
      for (const neuron of creature.neurons) {
        const squash = neuron.squash ?? "IDENTITY";
        squashCounts.set(squash, (squashCounts.get(squash) || 0) + 1);
        totalNeurons++;
      }
    }

    if (totalNeurons === 0 || squashCounts.size <= 1) {
      return 0;
    }

    // Calculate Shannon entropy
    let entropy = 0;
    for (const count of squashCounts.values()) {
      const probability = count / totalNeurons;
      if (probability > 0) {
        entropy -= probability * Math.log2(probability);
      }
    }

    return entropy;
  }

  /**
   * Calculates topology diversity based on neuron and synapse count variation.
   *
   * Higher values indicate more diverse network structures.
   *
   * @param creatures - Array of creatures to analyse
   * @returns Topology diversity score (0 = identical, higher = more diverse)
   */
  calculateTopologyDiversity(creatures: Creature[]): number {
    if (creatures.length < 2) {
      return 0;
    }

    // Collect topology metrics
    const neuronCounts: number[] = [];
    const synapseCounts: number[] = [];

    for (const creature of creatures) {
      neuronCounts.push(creature.neurons.length);
      synapseCounts.push(creature.synapses.length);
    }

    // Calculate coefficient of variation for each metric
    const neuronCV = this.coefficientOfVariation(neuronCounts);
    const synapseCV = this.coefficientOfVariation(synapseCounts);

    // Combine metrics (average of coefficients of variation)
    return (neuronCV + synapseCV) / 2;
  }

  /**
   * Calculates coefficient of variation (stddev / mean).
   */
  private coefficientOfVariation(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) {
      return 0;
    }

    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      values.length;
    const stddev = Math.sqrt(variance);

    return stddev / mean;
  }

  /**
   * Calculates the overall diversity score for a set of creatures.
   *
   * Combines weight variance, squash entropy, and topology diversity
   * using configured weights.
   *
   * @param creatures - Array of creatures to analyse
   * @returns Overall diversity score (0-1)
   */
  calculateDiversityScore(creatures: Creature[]): number {
    if (creatures.length < 2) {
      return 0;
    }

    const weightVariance = this.calculateWeightVariance(creatures);
    const squashEntropy = this.calculateSquashEntropy(creatures);
    const topologyDiversity = this.calculateTopologyDiversity(creatures);

    // Normalise each metric to [0, 1] range
    // Weight variance: use tanh to map to [0, 1]
    const normalisedWeightVariance = Math.tanh(weightVariance);

    // Squash entropy: normalise by max possible entropy (log2 of common squash count ~4)
    const maxEntropy = Math.log2(10); // Assume up to 10 different squash functions
    const normalisedSquashEntropy = Math.min(1, squashEntropy / maxEntropy);

    // Topology diversity: already coefficient of variation, cap at 1
    const normalisedTopologyDiversity = Math.min(1, topologyDiversity);

    // Weighted combination
    const totalWeight = this.config.weightVarianceWeight +
      this.config.squashEntropyWeight +
      this.config.topologyDiversityWeight;

    if (totalWeight === 0) {
      return 0;
    }

    const score = (normalisedWeightVariance * this.config.weightVarianceWeight +
      normalisedSquashEntropy * this.config.squashEntropyWeight +
      normalisedTopologyDiversity * this.config.topologyDiversityWeight) /
      totalWeight;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Gets the adjusted fitness score based on diversity contribution.
   *
   * Combines base fitness with diversity score using the configured weight.
   *
   * @param baseFitness - The creature's base fitness score
   * @param diversityScore - The creature's diversity contribution (0-1)
   * @returns Adjusted fitness score
   */
  getAdjustedFitness(baseFitness: number, diversityScore: number): number {
    if (!this.config.enabled) {
      return baseFitness;
    }

    const weight = this.config.diversityWeight;

    // Blend base fitness with diversity contribution
    // When weight = 0.15: 85% base fitness + 15% diversity bonus
    return (
      baseFitness * (1 - weight) + diversityScore * weight * baseFitness
    );
  }

  /**
   * Determines if a creature should be protected from culling based on diversity.
   *
   * Diverse creatures contribute to population robustness even with lower fitness.
   *
   * @param diversityScore - The creature's diversity contribution (0-1)
   * @returns true if creature should be protected
   */
  shouldProtectFromCulling(diversityScore: number): boolean {
    if (!this.config.enabled || !this.config.protectDiverseLowPerformers) {
      return false;
    }

    return diversityScore >= this.config.diversityProtectionThreshold;
  }

  /**
   * Determines if cross-species breeding should be triggered.
   *
   * When species diversity is too low, breeding from other species
   * can help introduce genetic variation.
   *
   * @param diversityScore - The species' overall diversity score (0-1)
   * @returns true if cross-species breeding should be triggered
   */
  shouldTriggerCrossSpeciesBreeding(diversityScore: number): boolean {
    if (!this.config.enabled) {
      return false;
    }

    return diversityScore < this.config.crossSpeciesBreedingThreshold;
  }

  /**
   * Gets comprehensive diversity metrics for a species.
   *
   * @param creatures - Array of creatures in the species
   * @returns Diversity metrics for the species
   */
  getSpeciesDiversityMetrics(creatures: Creature[]): SpeciesDiversityMetrics {
    if (creatures.length < 2) {
      return {
        weightVariance: 0,
        squashEntropy: 0,
        topologyDiversity: 0,
        overallDiversity: 0,
      };
    }

    const weightVariance = this.calculateWeightVariance(creatures);
    const squashEntropy = this.calculateSquashEntropy(creatures);
    const topologyDiversity = this.calculateTopologyDiversity(creatures);
    const overallDiversity = this.calculateDiversityScore(creatures);

    return {
      weightVariance,
      squashEntropy,
      topologyDiversity,
      overallDiversity,
    };
  }

  /**
   * Determines if a species has low diversity.
   *
   * @param diversityScore - The species' overall diversity score (0-1)
   * @returns true if species is considered low diversity
   */
  isLowDiversitySpecies(diversityScore: number): boolean {
    return diversityScore < this.config.lowDiversityThreshold;
  }

  /**
   * Calculates the genetic distance between two creatures.
   *
   * Used to prefer diverse parent combinations during selection.
   *
   * @param creature1 - First creature
   * @param creature2 - Second creature
   * @returns Genetic distance (0 = identical, higher = more different)
   */
  calculateGeneticDistance(creature1: Creature, creature2: Creature): number {
    let distance = 0;

    // Topology difference (normalised)
    const neuronDiff = Math.abs(
      creature1.neurons.length - creature2.neurons.length,
    );
    const synapseDiff = Math.abs(
      creature1.synapses.length - creature2.synapses.length,
    );
    const maxNeurons = Math.max(
      creature1.neurons.length,
      creature2.neurons.length,
    );
    const maxSynapses = Math.max(
      creature1.synapses.length,
      creature2.synapses.length,
    );

    if (maxNeurons > 0) {
      distance += neuronDiff / maxNeurons;
    }
    if (maxSynapses > 0) {
      distance += synapseDiff / maxSynapses;
    }

    // Squash function difference
    const squash1 = new Set(
      creature1.neurons.map((n) => n.squash ?? "IDENTITY"),
    );
    const squash2 = new Set(
      creature2.neurons.map((n) => n.squash ?? "IDENTITY"),
    );
    const allSquashes = new Set([...squash1, ...squash2]);
    const commonSquashes = [...squash1].filter((s) => squash2.has(s));
    if (allSquashes.size > 0) {
      const squashDistance = 1 - commonSquashes.length / allSquashes.size;
      distance += squashDistance;
    }

    // Normalise to [0, 1] range
    return Math.min(1, distance / 3);
  }

  /**
   * Gets a score for a parent pair that factors in genetic distance.
   *
   * Prefers diverse parent combinations to maintain population diversity.
   *
   * @param baseFitness - The father's base fitness score
   * @param mother - The mother creature
   * @param father - The potential father creature
   * @returns Adjusted score for this parent pair
   */
  getParentPairScore(
    baseFitness: number,
    mother: Creature,
    father: Creature,
  ): number {
    if (!this.config.enabled) {
      return baseFitness;
    }

    const geneticDistance = this.calculateGeneticDistance(mother, father);
    const weight = this.config.diverseParentPreferenceWeight;

    // Boost fitness based on genetic distance
    return baseFitness * (1 + geneticDistance * weight);
  }

  /**
   * Checks if ensemble diversity scoring is enabled.
   *
   * @returns true if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Gets the current configuration.
   *
   * @returns The configuration object
   */
  getConfig(): RequiredEnsembleDiversityConfig {
    return { ...this.config };
  }

  /**
   * Formats diversity metrics for logging.
   *
   * @param metrics - The diversity metrics to format
   * @returns A formatted string for logging
   */
  formatMetricsForLogging(metrics: SpeciesDiversityMetrics): string {
    return (
      `Diversity: ${(metrics.overallDiversity * 100).toFixed(1)}% ` +
      `(wgt=${(metrics.weightVariance * 100).toFixed(1)}%, ` +
      `sqh=${metrics.squashEntropy.toFixed(2)}, ` +
      `top=${(metrics.topologyDiversity * 100).toFixed(1)}%)`
    );
  }

  /**
   * Logs diversity metrics for a species.
   *
   * @param speciesKey - The species key identifier
   * @param metrics - The diversity metrics to log
   * @param verbose - Whether to include detailed metrics
   */
  logSpeciesDiversity(
    speciesKey: string,
    metrics: SpeciesDiversityMetrics,
    verbose = false,
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const summary = this.formatMetricsForLogging(metrics);
    const isLow = this.isLowDiversitySpecies(metrics.overallDiversity);
    const needsCrossBreeding = this.shouldTriggerCrossSpeciesBreeding(
      metrics.overallDiversity,
    );

    if (verbose || isLow) {
      let message = `[EnsembleDiversity] Species ${
        speciesKey.slice(0, 8)
      }...: ${summary}`;
      if (isLow) {
        message += " [LOW]";
      }
      if (needsCrossBreeding) {
        message += " [CROSS-BREED]";
      }
      console.info(message);
    }
  }

  /**
   * Logs population-wide diversity summary.
   *
   * @param speciesMetrics - Map of species key to diversity metrics
   * @param totalCreatures - Total number of creatures in population
   */
  logPopulationDiversitySummary(
    speciesMetrics: Map<string, SpeciesDiversityMetrics>,
    totalCreatures: number,
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const speciesCount = speciesMetrics.size;
    let lowDiversityCount = 0;
    let totalDiversity = 0;

    for (const metrics of speciesMetrics.values()) {
      totalDiversity += metrics.overallDiversity;
      if (this.isLowDiversitySpecies(metrics.overallDiversity)) {
        lowDiversityCount++;
      }
    }

    const avgDiversity = speciesCount > 0 ? totalDiversity / speciesCount : 0;

    console.info(
      `[EnsembleDiversity] Population: ${totalCreatures} creatures, ` +
        `${speciesCount} species, ` +
        `avg diversity: ${(avgDiversity * 100).toFixed(1)}%, ` +
        `low diversity species: ${lowDiversityCount}`,
    );
  }
}
