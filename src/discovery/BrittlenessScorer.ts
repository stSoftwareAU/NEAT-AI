/**
 * Brittleness Scorer
 *
 * Issue #1308 - Enhanced discovery candidate validation with brittleness scoring
 *
 * This module computes brittleness metrics for discovery candidates by testing
 * with perturbed inputs and measuring output variance.
 *
 * A brittle candidate shows:
 * - High variance in outputs when inputs are slightly perturbed
 * - Sensitivity to input distributions not in the test set
 * - Inconsistent behaviour across input ranges
 */

import type { Creature } from "../Creature.ts";

/**
 * Options for brittleness scoring.
 */
export interface BrittlenessScorerOptions {
  /** Magnitude of input perturbations (0.0 to 1.0). Default: 0.1 */
  perturbationMagnitude?: number;
  /** Number of perturbations to test per input. Default: 5 */
  perturbationsPerInput?: number;
  /** Seed for deterministic perturbations. Default: undefined (random) */
  seed?: number;
  /** Maximum brittleness score before rejection. Default: undefined (no limit) */
  brittlenessThreshold?: number;
}

/**
 * Result of brittleness scoring.
 */
export interface BrittlenessResult {
  /** Whether the candidate passed brittleness checks */
  passed: boolean;
  /** Computed brittleness score (higher = more brittle) */
  brittlenessScore: number;
  /** Variance of outputs across perturbations */
  outputVariance: number;
  /** Maximum output change observed */
  maxOutputChange: number;
  /** Mean output change observed */
  meanOutputChange: number;
  /** Number of inputs tested */
  testedInputCount: number;
  /** Total number of perturbations tested */
  totalPerturbations: number;
  /** Reason for rejection if failed */
  rejectionReason?: string;
}

/**
 * Simple seeded random number generator for deterministic perturbations.
 * Uses a Linear Congruential Generator (LCG) algorithm.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // LCG parameters (same as MINSTD)
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

/**
 * Perturb an input vector by adding small random changes.
 *
 * @param input - The original input vector
 * @param magnitude - Maximum perturbation magnitude (applied uniformly)
 * @param seed - Optional seed for deterministic perturbation
 * @returns Perturbed input vector
 */
export function perturbInput(
  input: Float32Array,
  magnitude: number,
  seed?: number,
): Float32Array {
  const random = seed !== undefined ? createSeededRandom(seed) : Math.random;
  const perturbed = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    // Perturbation in range [-magnitude, +magnitude]
    const perturbation = (random() * 2 - 1) * magnitude;
    perturbed[i] = input[i] + perturbation;
  }

  return perturbed;
}

/**
 * Brittleness Scorer for discovery candidates.
 *
 * Computes brittleness metrics by testing candidates with perturbed inputs
 * and measuring the variance in outputs.
 */
export class BrittlenessScorer {
  readonly #options: Required<BrittlenessScorerOptions>;

  constructor(options: BrittlenessScorerOptions = {}) {
    this.#options = {
      perturbationMagnitude: options.perturbationMagnitude ?? 0.1,
      perturbationsPerInput: options.perturbationsPerInput ?? 5,
      seed: options.seed ?? Math.floor(Math.random() * 2147483647),
      brittlenessThreshold: options.brittlenessThreshold ??
        Number.POSITIVE_INFINITY,
    };
  }

  /**
   * Compute the brittleness score for a candidate creature.
   *
   * @param creature - The candidate creature to test
   * @param inputs - Array of input vectors to test with
   * @returns Brittleness result
   */
  computeBrittleness(
    creature: Creature,
    inputs: Float32Array[],
  ): BrittlenessResult {
    if (inputs.length === 0) {
      return {
        passed: true,
        brittlenessScore: 0,
        outputVariance: 0,
        maxOutputChange: 0,
        meanOutputChange: 0,
        testedInputCount: 0,
        totalPerturbations: 0,
      };
    }

    const allOutputChanges: number[] = [];
    let seedOffset = this.#options.seed;
    let totalPerturbations = 0;

    for (const input of inputs) {
      // Get the baseline output for this input
      const baselineOutput = creature.activate(input);

      // Test multiple perturbations
      for (let p = 0; p < this.#options.perturbationsPerInput; p++) {
        const perturbedInput = perturbInput(
          input,
          this.#options.perturbationMagnitude,
          seedOffset++,
        );

        const perturbedOutput = creature.activate(perturbedInput);

        // Compute the output change (L2 norm across all outputs)
        let squaredDiff = 0;
        for (let i = 0; i < baselineOutput.length; i++) {
          const diff = perturbedOutput[i] - baselineOutput[i];
          squaredDiff += diff * diff;
        }
        const outputChange = Math.sqrt(squaredDiff);
        allOutputChanges.push(outputChange);
        totalPerturbations++;
      }
    }

    // Compute statistics
    const meanOutputChange = allOutputChanges.reduce((a, b) => a + b, 0) /
      allOutputChanges.length;

    let varianceSum = 0;
    for (const change of allOutputChanges) {
      const diff = change - meanOutputChange;
      varianceSum += diff * diff;
    }
    const outputVariance = varianceSum / allOutputChanges.length;

    const maxOutputChange = Math.max(...allOutputChanges);

    // Brittleness score combines mean change and variance
    // Higher values indicate more sensitivity to perturbations
    const brittlenessScore = meanOutputChange + Math.sqrt(outputVariance);

    const passed = brittlenessScore <= this.#options.brittlenessThreshold;

    const result: BrittlenessResult = {
      passed,
      brittlenessScore,
      outputVariance,
      maxOutputChange,
      meanOutputChange,
      testedInputCount: inputs.length,
      totalPerturbations,
    };

    if (!passed) {
      result.rejectionReason = `Brittleness score ${
        brittlenessScore.toPrecision(4)
      } exceeds threshold ${this.#options.brittlenessThreshold}`;
    }

    return result;
  }

  /**
   * Get the current options.
   */
  getOptions(): Readonly<Required<BrittlenessScorerOptions>> {
    return this.#options;
  }
}
