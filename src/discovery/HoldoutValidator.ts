/**
 * Holdout Validator
 *
 * Issue #1308 - Enhanced discovery candidate validation with holdout testing
 *
 * This module provides holdout validation for discovery candidates, reserving
 * a portion of training data unseen during discovery to validate candidates
 * against before acceptance.
 *
 * The holdout validation catches:
 * - Overfitting to the validation set
 * - Poor generalisation to unseen data
 * - Performance gaps between discovery and holdout data
 */

import type { Creature } from "../Creature.ts";
import type { DataRecordInterface } from "../architecture/DataSet.ts";
import { Costs } from "../Costs.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Options for holdout validation.
 */
export interface HoldoutValidatorOptions {
  /** Percentage of data to reserve for holdout (0.0 to 1.0). Default: 0.2 */
  holdoutPercentage?: number;
  /** Seed for deterministic data splitting. Default: undefined (random) */
  seed?: number;
  /** Maximum allowed performance gap before rejection. Default: undefined (no limit) */
  maxPerformanceGap?: number;
  /** Cost function name for evaluation. Default: "MSE" */
  costName?: string;
}

/**
 * Result of holdout validation.
 */
export interface HoldoutValidationResult {
  /** Whether the candidate passed holdout validation */
  passed: boolean;
  /** Error on the holdout dataset */
  holdoutError: number;
  /** Error on the training dataset (if computed) */
  trainingError?: number;
  /** Performance gap (holdout - training). Positive means overfitting */
  performanceGap?: number;
  /** Number of samples in the holdout set */
  holdoutSampleCount?: number;
  /** Reason for rejection if failed */
  rejectionReason?: string;
}

/**
 * Result of splitting data for holdout.
 */
export interface HoldoutSplit {
  /** Training data (larger portion) */
  training: DataRecordInterface[];
  /** Holdout data (reserved portion) */
  holdout: DataRecordInterface[];
}

/**
 * Simple seeded random number generator for deterministic splitting.
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
 * Split data into training and holdout sets.
 *
 * @param data - The full dataset to split
 * @param holdoutPercentage - Percentage to reserve for holdout (0.0 to 1.0)
 * @param seed - Optional seed for deterministic splitting
 * @returns Split containing training and holdout datasets
 */
export function splitDataForHoldout(
  data: DataRecordInterface[],
  holdoutPercentage: number,
  seed?: number,
): HoldoutSplit {
  const holdoutCount = Math.round(data.length * holdoutPercentage);

  if (holdoutCount === 0 || holdoutCount >= data.length) {
    // Edge case: can't create a meaningful split
    if (holdoutCount >= data.length) {
      return {
        training: [],
        holdout: [...data],
      };
    }
    return {
      training: [...data],
      holdout: [],
    };
  }

  // Create a shuffled array of indices
  const indices = Array.from({ length: data.length }, (_, i) => i);

  // Use seeded or standard random for shuffling
  const random = seed !== undefined
    ? createSeededRandom(seed)
    : () => getRandomNumberGenerator().random();

  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Split the shuffled indices
  const holdoutIndices = new Set(indices.slice(0, holdoutCount));

  const training: DataRecordInterface[] = [];
  const holdout: DataRecordInterface[] = [];

  for (let i = 0; i < data.length; i++) {
    if (holdoutIndices.has(i)) {
      holdout.push(data[i]);
    } else {
      training.push(data[i]);
    }
  }

  return { training, holdout };
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
 * Holdout Validator for discovery candidates.
 *
 * Validates candidates against a holdout dataset to catch overfitting
 * and ensure good generalisation before integration.
 */
export class HoldoutValidator {
  readonly #options: Required<HoldoutValidatorOptions>;

  constructor(options: HoldoutValidatorOptions = {}) {
    this.#options = {
      holdoutPercentage: options.holdoutPercentage ?? 0.2,
      seed: options.seed ??
        Math.floor(getRandomNumberGenerator().random() * 2147483647),
      maxPerformanceGap: options.maxPerformanceGap ?? Number.POSITIVE_INFINITY,
      costName: options.costName ?? "MSE",
    };
  }

  /**
   * Validate a candidate creature against holdout data.
   *
   * @param creature - The candidate creature to validate
   * @param holdoutDataDir - Directory containing holdout data files
   * @returns Validation result
   */
  validateCandidate(
    creature: Creature,
    holdoutDataDir: string,
  ): HoldoutValidationResult {
    const costFunction = Costs.find(this.#options.costName);
    if (!costFunction) {
      throw new Error(`Unknown cost function: ${this.#options.costName}`);
    }

    // Load holdout data and compute error
    const records = loadDataFromDir(
      holdoutDataDir,
      creature.input,
      creature.output,
    );

    const { error, sampleCount } = this.#computeError(
      creature,
      records,
      costFunction,
    );

    const result: HoldoutValidationResult = {
      passed: true,
      holdoutError: error,
      holdoutSampleCount: sampleCount,
    };

    return result;
  }

  /**
   * Validate a candidate with both training and holdout data to compute
   * the performance gap.
   *
   * @param creature - The candidate creature to validate
   * @param trainingDataDir - Directory containing training data files
   * @param holdoutDataDir - Directory containing holdout data files
   * @returns Validation result with performance gap
   */
  validateWithGap(
    creature: Creature,
    trainingDataDir: string,
    holdoutDataDir: string,
  ): HoldoutValidationResult {
    const costFunction = Costs.find(this.#options.costName);
    if (!costFunction) {
      throw new Error(`Unknown cost function: ${this.#options.costName}`);
    }

    // Load and compute errors
    const trainingRecords = loadDataFromDir(
      trainingDataDir,
      creature.input,
      creature.output,
    );
    const holdoutRecords = loadDataFromDir(
      holdoutDataDir,
      creature.input,
      creature.output,
    );

    const trainingResult = this.#computeError(
      creature,
      trainingRecords,
      costFunction,
    );
    const holdoutResult = this.#computeError(
      creature,
      holdoutRecords,
      costFunction,
    );

    const performanceGap = holdoutResult.error - trainingResult.error;
    const passed = Math.abs(performanceGap) <= this.#options.maxPerformanceGap;

    const result: HoldoutValidationResult = {
      passed,
      holdoutError: holdoutResult.error,
      trainingError: trainingResult.error,
      performanceGap,
      holdoutSampleCount: holdoutResult.sampleCount,
    };

    if (!passed) {
      result.rejectionReason = `Performance gap ${
        performanceGap.toPrecision(4)
      } exceeds threshold ${this.#options.maxPerformanceGap}`;
    }

    return result;
  }

  /**
   * Compute the error for a creature on a dataset.
   */
  #computeError(
    creature: Creature,
    records: DataRecordInterface[],
    costFunction: {
      calculate: (targets: Float32Array, outputs: Float32Array) => number;
    },
  ): { error: number; sampleCount: number } {
    let totalError = 0;
    let sampleCount = 0;

    for (const record of records) {
      const output = creature.activate(record.input);
      const error = costFunction.calculate(record.output, output);
      totalError += error;
      sampleCount++;
    }

    const avgError = sampleCount > 0 ? totalError / sampleCount : 0;
    return { error: avgError, sampleCount };
  }

  /**
   * Get the current options.
   */
  getOptions(): Readonly<Required<HoldoutValidatorOptions>> {
    return this.#options;
  }
}
