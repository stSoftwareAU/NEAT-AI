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
 * Type definitions and grouping logic extracted to BatchValidatorTypes.ts.
 */

import type { Creature } from "../Creature.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import { EnhancedDiscoveryValidator } from "./EnhancedDiscoveryValidator.ts";
import {
  type BatchValidationResult,
  type BatchValidationStats,
  type BatchValidatorOptions,
  groupCandidatesByType,
  type ValidationCacheEntry,
} from "./BatchValidatorTypes.ts";

// Re-export for backward compatibility.
export type {
  BatchValidationResult,
  BatchValidationStats,
  BatchValidatorOptions,
  GroupedCandidates,
  ValidationCacheEntry,
} from "./BatchValidatorTypes.ts";
export { groupCandidatesByType } from "./BatchValidatorTypes.ts";

/**
 * Batch Discovery Validator
 *
 * Validates multiple discovery candidates efficiently using:
 * - Type-based grouping for optimal validation order
 * - Early-exit on structural failures (configurable)
 * - Validation result caching to avoid redundant work
 */
export class BatchDiscoveryValidator {
  readonly #options: BatchValidatorOptions & {
    feedbackLoop: boolean;
    earlyExitOnStructuralFailure: boolean;
    maxCacheSize: number;
  };
  #cache: Map<string, ValidationCacheEntry>;
  #stats: BatchValidationStats;
  readonly #enhancedValidator?: EnhancedDiscoveryValidator;

  constructor(options: BatchValidatorOptions = {}) {
    this.#options = {
      feedbackLoop: options.feedbackLoop ?? false,
      earlyExitOnStructuralFailure: options.earlyExitOnStructuralFailure ??
        false,
      maxCacheSize: options.maxCacheSize ?? 1000,
      holdout: options.holdout,
      brittleness: options.brittleness,
      verbose: options.verbose,
      dataDir: options.dataDir,
    };

    this.#cache = new Map();
    this.#stats = this.#createEmptyStats();

    // Initialise enhanced validator if holdout or brittleness is enabled
    if (options.holdout?.enabled || options.brittleness?.enabled) {
      this.#enhancedValidator = new EnhancedDiscoveryValidator({
        holdout: options.holdout,
        brittleness: options.brittleness,
        verbose: options.verbose,
      });
    }
  }

  /**
   * Validate a batch of discovery candidates.
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
   * Validate a batch of discovery candidates with enhanced validation.
   */
  validateBatchWithEnhanced(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
  ): BatchValidationResult[] {
    // First, run basic validation
    const results = this.validateBatch(baseCreature, candidates);

    // If enhanced validator is not configured or no dataDir, return basic results
    if (!this.#enhancedValidator || !this.#options.dataDir) {
      return results;
    }

    // Run enhanced validation on candidates that passed basic validation
    for (const result of results) {
      if (!result.valid || result.cached) {
        continue;
      }

      const enhancedResult = this.#enhancedValidator.validateCandidate(
        baseCreature,
        result.candidate,
        this.#options.dataDir,
      );

      result.enhancedResult = enhancedResult;

      if (!enhancedResult.passed) {
        result.valid = false;
        const reasons = enhancedResult.rejectionReasons?.join("; ") ??
          "Enhanced validation failed";
        result.error = reasons;
        this.#stats.validCount--;
        this.#stats.invalidCount++;
        this.#stats.enhancedRejectionCount++;
      }
    }

    return results;
  }

  /**
   * Check if enhanced validation is enabled.
   */
  isEnhancedValidationEnabled(): boolean {
    return this.#enhancedValidator !== undefined;
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

  #shouldEnforceForwardOnly(
    baseCreature: Creature,
    candidateCreature: Creature,
  ): boolean {
    return baseCreature.forwardOnly === true ||
      candidateCreature.forwardOnly === true;
  }

  /**
   * Cache a validation result.
   */
  #cacheResult(
    structureHash: string,
    valid: boolean,
    error?: string,
  ): void {
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
      enhancedRejectionCount: 0,
    };
  }
}

/**
 * Generate a simple structure hash for cache key generation.
 */
function generateStructureHash(creature: Creature): string {
  const neuronCount = creature.neurons.length;
  const synapseCount = creature.synapses.length;
  const version = creature.semanticVersion;
  const forwardOnly = creature.forwardOnly === true;
  const uuid = creature.uuid ?? "no-uuid";

  return `${neuronCount}:${synapseCount}:${version}:${forwardOnly}:${uuid}`;
}

/**
 * Validate multiple candidates in a single batch operation.
 */
export function validateDiscoveryCandidatesBatch(
  baseCreature: Creature,
  candidates: DiscoveryCandidate[],
  options: BatchValidatorOptions = {},
): BatchValidationResult[] {
  const validator = new BatchDiscoveryValidator(options);
  return validator.validateBatch(baseCreature, candidates);
}

/**
 * Validate multiple candidates with enhanced validation (holdout/brittleness).
 */
export function validateDiscoveryCandidatesBatchWithEnhanced(
  baseCreature: Creature,
  candidates: DiscoveryCandidate[],
  options: BatchValidatorOptions = {},
): BatchValidationResult[] {
  const validator = new BatchDiscoveryValidator(options);
  return validator.validateBatchWithEnhanced(baseCreature, candidates);
}
