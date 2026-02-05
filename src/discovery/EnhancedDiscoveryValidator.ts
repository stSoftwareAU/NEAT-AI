/**
 * Enhanced Discovery Validator
 *
 * Issue #1308 - Enhanced discovery candidate validation with holdout testing
 *
 * This module combines holdout validation and brittleness scoring to provide
 * comprehensive validation of discovery candidates before integration.
 *
 * The enhanced validator catches:
 * - Overfitting to the validation set (holdout check)
 * - Sensitivity to input perturbations (brittleness check)
 * - Edge cases not represented in validation data
 */

import type { Creature } from "../Creature.ts";
import type { DataRecordInterface } from "../architecture/DataSet.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import {
  type HoldoutValidationResult,
  type HoldoutValidatorOptions,
  splitDataForHoldout,
} from "./HoldoutValidator.ts";
import {
  type BrittlenessResult,
  BrittlenessScorer,
  type BrittlenessScorerOptions,
} from "./BrittlenessScorer.ts";

/**
 * Options for holdout validation in enhanced validator.
 */
export interface EnhancedHoldoutOptions extends HoldoutValidatorOptions {
  /** Whether holdout validation is enabled. Default: false */
  enabled?: boolean;
}

/**
 * Options for brittleness scoring in enhanced validator.
 */
export interface EnhancedBrittlenessOptions extends BrittlenessScorerOptions {
  /** Whether brittleness scoring is enabled. Default: false */
  enabled?: boolean;
}

/**
 * Options for the enhanced discovery validator.
 */
export interface EnhancedValidationOptions {
  /** Holdout validation options */
  holdout?: EnhancedHoldoutOptions;
  /** Brittleness scoring options */
  brittleness?: EnhancedBrittlenessOptions;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Cost function name for evaluation. Default: "MSE" */
  costName?: string;
}

/**
 * Result of enhanced validation.
 */
export interface EnhancedValidationResult {
  /** Whether the candidate passed all enabled validations */
  passed: boolean;
  /** Result from holdout validation (if enabled) */
  holdoutResult?: HoldoutValidationResult;
  /** Result from brittleness scoring (if enabled) */
  brittlenessResult?: BrittlenessResult;
  /** Combined brittleness score (if both enabled) */
  combinedBrittlenessScore?: number;
  /** List of rejection reasons if failed */
  rejectionReasons?: string[];
  /** Total validation time in milliseconds */
  validationTime?: number;
}

/**
 * Load data records from a binary data directory.
 *
 * @param dataDir - Directory containing binary data files
 * @param inputSize - Number of input values per record
 * @param outputSize - Number of output values per record
 * @returns Array of data records
 */
function loadDataFromDir(
  dataDir: string,
  inputSize: number,
  outputSize: number,
): DataRecordInterface[] {
  const records: DataRecordInterface[] = [];
  const valuesCount = inputSize + outputSize;
  const bytesPerRecord = valuesCount * 4;

  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile && dirEntry.name.endsWith(".bin")) {
      const filePath = `${dataDir}/${dirEntry.name}`;
      const fileData = Deno.readFileSync(filePath);
      const recordCount = fileData.byteLength / bytesPerRecord;

      for (let i = 0; i < recordCount; i++) {
        const offset = i * bytesPerRecord;
        const recordBuffer = fileData.slice(offset, offset + bytesPerRecord);
        const recordArray = new Float32Array(recordBuffer.buffer);

        records.push({
          input: new Float32Array(recordArray.subarray(0, inputSize)),
          output: new Float32Array(recordArray.subarray(inputSize)),
        });
      }
    }
  }

  return records;
}

/**
 * Enhanced Discovery Validator
 *
 * Provides comprehensive validation of discovery candidates using:
 * - Holdout validation (catch overfitting)
 * - Brittleness scoring (catch sensitivity to input perturbations)
 */
export class EnhancedDiscoveryValidator {
  readonly #options: EnhancedValidationOptions;
  readonly #brittlenessScorer?: BrittlenessScorer;

  constructor(options: EnhancedValidationOptions = {}) {
    this.#options = options;

    // Initialise brittleness scorer if enabled
    if (options.brittleness?.enabled) {
      this.#brittlenessScorer = new BrittlenessScorer({
        perturbationMagnitude: options.brittleness.perturbationMagnitude,
        perturbationsPerInput: options.brittleness.perturbationsPerInput,
        seed: options.brittleness.seed,
        brittlenessThreshold: options.brittleness.brittlenessThreshold,
      });
    }
  }

  /**
   * Validate a single candidate with all enabled checks.
   *
   * @param baseCreature - The base creature for comparison
   * @param candidate - The discovery candidate to validate
   * @param dataDir - Directory containing training data
   * @returns Enhanced validation result
   */
  validateCandidate(
    _baseCreature: Creature,
    candidate: DiscoveryCandidate,
    dataDir: string,
  ): EnhancedValidationResult {
    const startTime = performance.now();
    const rejectionReasons: string[] = [];

    let holdoutResult: HoldoutValidationResult | undefined;
    let brittlenessResult: BrittlenessResult | undefined;

    // Run holdout validation if enabled
    if (this.#options.holdout?.enabled) {
      holdoutResult = this.#runHoldoutValidation(
        candidate.creature,
        dataDir,
      );

      if (!holdoutResult.passed && holdoutResult.rejectionReason) {
        rejectionReasons.push(holdoutResult.rejectionReason);
      }
    }

    // Run brittleness scoring if enabled
    if (this.#brittlenessScorer && this.#options.brittleness?.enabled) {
      brittlenessResult = this.#runBrittlenessScoring(
        candidate.creature,
        dataDir,
      );

      if (!brittlenessResult.passed && brittlenessResult.rejectionReason) {
        rejectionReasons.push(brittlenessResult.rejectionReason);
      }
    }

    // Compute combined brittleness score if both are available
    let combinedBrittlenessScore: number | undefined;
    if (holdoutResult && brittlenessResult) {
      combinedBrittlenessScore = this.#computeCombinedBrittleness(
        holdoutResult,
        brittlenessResult,
      );
    }

    const validationTime = performance.now() - startTime;

    // Overall pass requires all enabled checks to pass
    const holdoutPassed = !this.#options.holdout?.enabled ||
      (holdoutResult?.passed ?? true);
    const brittlenessPassed = !this.#options.brittleness?.enabled ||
      (brittlenessResult?.passed ?? true);
    const passed = holdoutPassed && brittlenessPassed;

    const result: EnhancedValidationResult = {
      passed,
      holdoutResult,
      brittlenessResult,
      combinedBrittlenessScore,
      validationTime,
    };

    if (rejectionReasons.length > 0) {
      result.rejectionReasons = rejectionReasons;
    }

    if (this.#options.verbose) {
      this.#logValidationResult(candidate, result);
    }

    return result;
  }

  /**
   * Validate a batch of candidates.
   *
   * @param baseCreature - The base creature for comparison
   * @param candidates - The discovery candidates to validate
   * @param dataDir - Directory containing training data
   * @returns Array of validation results
   */
  validateBatch(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
    dataDir: string,
  ): EnhancedValidationResult[] {
    return candidates.map((candidate) =>
      this.validateCandidate(baseCreature, candidate, dataDir)
    );
  }

  /**
   * Check if enhanced validation is enabled.
   */
  isEnabled(): boolean {
    return Boolean(this.#options.holdout?.enabled) ||
      Boolean(this.#options.brittleness?.enabled);
  }

  /**
   * Run holdout validation for a creature.
   */
  #runHoldoutValidation(
    creature: Creature,
    dataDir: string,
  ): HoldoutValidationResult {
    // Load data from dataDir and split it
    const allData = loadDataFromDir(dataDir, creature.input, creature.output);

    const holdoutPercentage = this.#options.holdout?.holdoutPercentage ?? 0.2;
    const seed = this.#options.holdout?.seed;
    const { training, holdout } = splitDataForHoldout(
      allData,
      holdoutPercentage,
      seed,
    );

    // Compute errors on both sets
    let trainingError = 0;
    let trainingCount = 0;
    for (const record of training) {
      const output = creature.activate(record.input);
      let error = 0;
      for (let i = 0; i < record.output.length; i++) {
        const diff = output[i] - record.output[i];
        error += diff * diff;
      }
      trainingError += error / record.output.length;
      trainingCount++;
    }
    trainingError = trainingCount > 0 ? trainingError / trainingCount : 0;

    let holdoutError = 0;
    let holdoutCount = 0;
    for (const record of holdout) {
      const output = creature.activate(record.input);
      let error = 0;
      for (let i = 0; i < record.output.length; i++) {
        const diff = output[i] - record.output[i];
        error += diff * diff;
      }
      holdoutError += error / record.output.length;
      holdoutCount++;
    }
    holdoutError = holdoutCount > 0 ? holdoutError / holdoutCount : 0;

    const performanceGap = holdoutError - trainingError;
    const maxGap = this.#options.holdout?.maxPerformanceGap ??
      Number.POSITIVE_INFINITY;
    const passed = Math.abs(performanceGap) <= maxGap;

    const result: HoldoutValidationResult = {
      passed,
      holdoutError,
      trainingError,
      performanceGap,
      holdoutSampleCount: holdoutCount,
    };

    if (!passed) {
      result.rejectionReason = `Performance gap ${
        performanceGap.toPrecision(4)
      } exceeds threshold ${maxGap}`;
    }

    return result;
  }

  /**
   * Run brittleness scoring for a creature.
   */
  #runBrittlenessScoring(
    creature: Creature,
    dataDir: string,
  ): BrittlenessResult {
    if (!this.#brittlenessScorer) {
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

    // Load sample inputs from data directory
    const allData = loadDataFromDir(dataDir, creature.input, creature.output);
    const maxSamples = 50; // Limit samples for performance
    const sampleInputs = allData.slice(0, maxSamples).map((d) => d.input);

    return this.#brittlenessScorer.computeBrittleness(creature, sampleInputs);
  }

  /**
   * Compute a combined brittleness score from holdout and perturbation results.
   *
   * The combined score considers:
   * - Performance gap (overfitting indicator)
   * - Output variance under perturbation
   */
  #computeCombinedBrittleness(
    holdoutResult: HoldoutValidationResult,
    brittlenessResult: BrittlenessResult,
  ): number {
    // Weight factors for combining scores
    const gapWeight = 0.5;
    const brittlenessWeight = 0.5;

    // Normalise performance gap (positive gap indicates overfitting)
    const normalisedGap = Math.abs(holdoutResult.performanceGap ?? 0);

    // Combine weighted scores
    return gapWeight * normalisedGap +
      brittlenessWeight * brittlenessResult.brittlenessScore;
  }

  /**
   * Log validation result (when verbose).
   */
  #logValidationResult(
    candidate: DiscoveryCandidate,
    result: EnhancedValidationResult,
  ): void {
    const status = result.passed ? "✓ PASSED" : "✗ FAILED";
    const changeType = candidate.change.type;

    console.info(
      `[EnhancedValidator] ${status} ${changeType}`,
    );

    if (result.holdoutResult) {
      console.info(
        `[EnhancedValidator]   Holdout: error=${
          result.holdoutResult.holdoutError.toPrecision(4)
        } gap=${(result.holdoutResult.performanceGap ?? 0).toPrecision(4)}`,
      );
    }

    if (result.brittlenessResult) {
      console.info(
        `[EnhancedValidator]   Brittleness: score=${
          result.brittlenessResult.brittlenessScore.toPrecision(4)
        } variance=${result.brittlenessResult.outputVariance.toPrecision(4)}`,
      );
    }

    if (result.combinedBrittlenessScore !== undefined) {
      console.info(
        `[EnhancedValidator]   Combined: ${
          result.combinedBrittlenessScore.toPrecision(4)
        }`,
      );
    }

    if (result.rejectionReasons && result.rejectionReasons.length > 0) {
      for (const reason of result.rejectionReasons) {
        console.info(`[EnhancedValidator]   Rejection: ${reason}`);
      }
    }
  }
}
