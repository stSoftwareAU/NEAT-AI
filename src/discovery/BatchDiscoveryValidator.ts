/**
 * Batch Discovery Validator
 *
 * Issue #1291 - Performance: Batch discovery candidate validation
 *
 * This module provides batch validation for discovery candidates, reducing
 * the overhead of individual validation calls by:
 * 1. Grouping candidates by type (structural vs weight-only changes)
 * 2. Validating structural candidates with early-exit on first invalid
 * 3. Caching common validation results across candidates
 *
 * The batch validator is designed to improve the discovery phase performance
 * by 15-25% through reduced redundant validation work and better cache utilisation.
 */

import type { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { getMajorVersion } from "../upgrade/Upgrade.ts";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";

/**
 * Result of a batch validation for a single candidate.
 */
export interface BatchValidationResult {
  /** The candidate that was validated */
  candidate: DiscoveryCandidate;
  /** Whether the candidate passed validation */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Whether this result came from the cache */
  cached?: boolean;
}

/**
 * Cache entry for validation results.
 */
export interface ValidationCacheEntry {
  /** Hash of the creature structure for cache key generation */
  structureHash: string;
  /** Whether the creature passed validation */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Timestamp when cached */
  cachedAt: number;
}

/**
 * Statistics from batch validation.
 */
export interface BatchValidationStats {
  /** Total number of validations performed */
  totalValidations: number;
  /** Number of candidates that passed validation */
  validCount: number;
  /** Number of candidates that failed validation */
  invalidCount: number;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
  /** Number of structural candidates validated */
  structuralCount: number;
  /** Number of weight-only candidates validated */
  weightOnlyCount: number;
  /** Whether early exit was triggered */
  earlyExitTriggered: boolean;
}

/**
 * Options for the batch validator.
 */
export interface BatchValidatorOptions {
  /** Whether feedback loops are enabled (recurrent mode) */
  feedbackLoop?: boolean;
  /** Whether to exit early on first structural validation failure */
  earlyExitOnStructuralFailure?: boolean;
  /** Maximum cache size before pruning */
  maxCacheSize?: number;
}

/**
 * Grouped candidates by type for batch processing.
 */
export interface GroupedCandidates {
  /** Candidates that involve structural changes (add/remove neurons/synapses) */
  structural: DiscoveryCandidate[];
  /** Candidates that only involve weight/bias changes (squash changes) */
  weightOnly: DiscoveryCandidate[];
}

/**
 * Structural change types that modify the network topology.
 */
const STRUCTURAL_CHANGE_TYPES: Set<DiscoveryChangeType> = new Set([
  "add-synapses",
  "add-neurons",
  "coordinated-structural",
  "remove-synapse",
  "remove-neuron",
  "remove-low-impact",
  "combo-add-remove",
  "combo-all",
  "combo-best-of-category",
  "combo-successful",
]);

/**
 * Weight-only change types that don't modify topology.
 */
const WEIGHT_ONLY_CHANGE_TYPES: Set<DiscoveryChangeType> = new Set([
  "change-squash",
  "combo-add-change",
]);

/**
 * Group discovery candidates by type for efficient batch processing.
 *
 * Structural changes (add/remove neurons/synapses) are grouped separately
 * from weight-only changes (squash changes) because they have different
 * validation requirements and failure patterns.
 *
 * @param candidates - The candidates to group
 * @returns Grouped candidates by type
 */
export function groupCandidatesByType(
  candidates: DiscoveryCandidate[],
): GroupedCandidates {
  const structural: DiscoveryCandidate[] = [];
  const weightOnly: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const changeType = candidate.change.type;
    if (STRUCTURAL_CHANGE_TYPES.has(changeType)) {
      structural.push(candidate);
    } else if (WEIGHT_ONLY_CHANGE_TYPES.has(changeType)) {
      weightOnly.push(candidate);
    } else {
      // Default to structural for unknown types (safer)
      structural.push(candidate);
    }
  }

  return { structural, weightOnly };
}

/**
 * Generate a simple structure hash for cache key generation.
 *
 * This hash captures the essential structural characteristics that affect
 * validation, without being overly expensive to compute.
 */
function generateStructureHash(creature: Creature): string {
  const neuronCount = creature.neurons.length;
  const synapseCount = creature.synapses.length;
  const version = creature.semanticVersion;
  const forwardOnly = creature.forwardOnly === true;

  // Include UUID if available for more precise caching
  const uuid = creature.uuid ?? "no-uuid";

  return `${neuronCount}:${synapseCount}:${version}:${forwardOnly}:${uuid}`;
}

/**
 * Batch Discovery Validator
 *
 * Validates multiple discovery candidates efficiently using:
 * - Type-based grouping for optimal validation order
 * - Early-exit on structural failures (configurable)
 * - Validation result caching to avoid redundant work
 */
export class BatchDiscoveryValidator {
  readonly #options: Required<BatchValidatorOptions>;
  #cache: Map<string, ValidationCacheEntry>;
  #stats: BatchValidationStats;

  constructor(options: BatchValidatorOptions = {}) {
    this.#options = {
      feedbackLoop: options.feedbackLoop ?? false,
      earlyExitOnStructuralFailure: options.earlyExitOnStructuralFailure ??
        false,
      maxCacheSize: options.maxCacheSize ?? 1000,
    };

    this.#cache = new Map();
    this.#stats = this.#createEmptyStats();
  }

  /**
   * Validate a batch of discovery candidates.
   *
   * Candidates are grouped by type and validated in optimal order:
   * 1. Structural candidates first (with optional early-exit on failure)
   * 2. Weight-only candidates second
   *
   * @param baseCreature - The base creature the candidates are derived from
   * @param candidates - The candidates to validate
   * @returns Validation results for each candidate
   */
  validateBatch(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
  ): BatchValidationResult[] {
    const results: BatchValidationResult[] = [];
    const grouped = groupCandidatesByType(candidates);

    // Validate structural candidates first
    const structuralResults = this.#validateStructuralCandidates(
      baseCreature,
      grouped.structural,
    );
    results.push(...structuralResults);

    // If early exit was triggered, mark remaining weight-only as not validated
    if (
      this.#options.earlyExitOnStructuralFailure &&
      this.#stats.earlyExitTriggered
    ) {
      for (const candidate of grouped.weightOnly) {
        results.push({
          candidate,
          valid: false,
          error: "Skipped due to structural validation failure",
          cached: false,
        });
        this.#stats.invalidCount++;
      }
    } else {
      // Validate weight-only candidates
      const weightOnlyResults = this.#validateWeightOnlyCandidates(
        baseCreature,
        grouped.weightOnly,
      );
      results.push(...weightOnlyResults);
    }

    return results;
  }

  /**
   * Validate structural candidates with optional early-exit.
   */
  #validateStructuralCandidates(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
  ): BatchValidationResult[] {
    const results: BatchValidationResult[] = [];

    for (const candidate of candidates) {
      this.#stats.structuralCount++;

      const result = this.#validateCandidate(baseCreature, candidate);
      results.push(result);

      // Early exit on first failure if enabled
      if (
        this.#options.earlyExitOnStructuralFailure && !result.valid
      ) {
        this.#stats.earlyExitTriggered = true;
        break;
      }
    }

    return results;
  }

  /**
   * Validate weight-only candidates.
   */
  #validateWeightOnlyCandidates(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
  ): BatchValidationResult[] {
    const results: BatchValidationResult[] = [];

    for (const candidate of candidates) {
      this.#stats.weightOnlyCount++;
      const result = this.#validateCandidate(baseCreature, candidate);
      results.push(result);
    }

    return results;
  }

  /**
   * Validate a single candidate, using cache when possible.
   */
  #validateCandidate(
    baseCreature: Creature,
    candidate: DiscoveryCandidate,
  ): BatchValidationResult {
    this.#stats.totalValidations++;

    const creature = candidate.creature;
    const structureHash = generateStructureHash(creature);

    // Check cache first
    const cachedResult = this.#cache.get(structureHash);
    if (cachedResult !== undefined) {
      this.#stats.cacheHits++;
      if (cachedResult.valid) {
        this.#stats.validCount++;
      } else {
        this.#stats.invalidCount++;
      }
      return {
        candidate,
        valid: cachedResult.valid,
        error: cachedResult.error,
        cached: true,
      };
    }

    this.#stats.cacheMisses++;

    // Determine validation mode based on base creature and options
    const forwardOnly = this.#shouldEnforceForwardOnly(baseCreature, creature);

    try {
      if (forwardOnly) {
        creatureValidate(creature, { forwardOnly: true });
        creature.forwardOnly = true;
        this.#bumpToFourIfForwardOnlyConfirmed(creature);
      } else if (this.#options.feedbackLoop) {
        creatureValidate(creature);
      } else {
        creatureValidate(creature, { feedbackLoop: false });
      }

      // Cache successful result
      this.#cacheResult(structureHash, true);
      this.#stats.validCount++;

      return {
        candidate,
        valid: true,
        cached: false,
      };
    } catch (e) {
      const error = e as Error;
      const errorMessage = `${error.name}: ${error.message}`;

      // Cache failure result
      this.#cacheResult(structureHash, false, errorMessage);
      this.#stats.invalidCount++;

      return {
        candidate,
        valid: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  /**
   * Determine whether forward-only validation should be enforced.
   */
  #shouldEnforceForwardOnly(
    baseCreature: Creature,
    candidateCreature: Creature,
  ): boolean {
    // If either creature is 4.x+, forward-only is a hard invariant
    const baseMajor = getMajorVersion(baseCreature.semanticVersion);
    const candidateMajor = getMajorVersion(candidateCreature.semanticVersion);

    if (baseMajor >= 4 || candidateMajor >= 4) {
      return true;
    }

    // If either is explicitly forward-only, enforce it
    if (
      baseCreature.forwardOnly === true ||
      candidateCreature.forwardOnly === true
    ) {
      return true;
    }

    // If feedback loop is disabled, use forward-only validation
    if (this.#options.feedbackLoop !== true) {
      return true;
    }

    return false;
  }

  /**
   * Upgrade 2.x/3.x creatures to 4.x once forward-only validity is confirmed.
   */
  #bumpToFourIfForwardOnlyConfirmed(creature: Creature): void {
    const major = getMajorVersion(creature.semanticVersion);
    if (major === 2 || major === 3) {
      creature.semanticVersion = "4.0.0";
    }
  }

  /**
   * Cache a validation result.
   */
  #cacheResult(
    structureHash: string,
    valid: boolean,
    error?: string,
  ): void {
    // Prune cache if it's too large
    if (this.#cache.size >= this.#options.maxCacheSize) {
      this.#pruneCache();
    }

    this.#cache.set(structureHash, {
      structureHash,
      valid,
      error,
      cachedAt: Date.now(),
    });
  }

  /**
   * Prune oldest cache entries.
   */
  #pruneCache(): void {
    // Remove the oldest 25% of entries
    const entriesToRemove = Math.floor(this.#options.maxCacheSize * 0.25);
    const entries = [...this.#cache.entries()]
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt);

    for (let i = 0; i < entriesToRemove && i < entries.length; i++) {
      this.#cache.delete(entries[i][0]);
    }
  }

  /**
   * Get validation statistics.
   */
  getStats(): BatchValidationStats {
    return { ...this.#stats };
  }

  /**
   * Reset the validator state (cache and statistics).
   */
  reset(): void {
    this.#cache.clear();
    this.#stats = this.#createEmptyStats();
  }

  /**
   * Clear only the cache, keeping statistics.
   */
  clearCache(): void {
    this.#cache.clear();
  }

  /**
   * Get the current cache size.
   */
  getCacheSize(): number {
    return this.#cache.size;
  }

  /**
   * Create empty statistics object.
   */
  #createEmptyStats(): BatchValidationStats {
    return {
      totalValidations: 0,
      validCount: 0,
      invalidCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      structuralCount: 0,
      weightOnlyCount: 0,
      earlyExitTriggered: false,
    };
  }
}

/**
 * Validate multiple candidates in a single batch operation.
 *
 * This is a convenience function that creates a BatchDiscoveryValidator
 * and validates all candidates.
 *
 * @param baseCreature - The base creature
 * @param candidates - The candidates to validate
 * @param options - Validation options
 * @returns Array of validation results
 */
export function validateDiscoveryCandidatesBatch(
  baseCreature: Creature,
  candidates: DiscoveryCandidate[],
  options: BatchValidatorOptions = {},
): BatchValidationResult[] {
  const validator = new BatchDiscoveryValidator(options);
  return validator.validateBatch(baseCreature, candidates);
}
