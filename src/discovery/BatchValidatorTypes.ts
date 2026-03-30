/**
 * Batch Validator Types Module
 *
 * Interface definitions, constants, and grouping logic for
 * the batch discovery validator.
 *
 * Extracted from BatchDiscoveryValidator.ts as part of #1598.
 */

import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "@discovery/DiscoveryCandidates.ts";
import type {
  EnhancedBrittlenessOptions,
  EnhancedHoldoutOptions,
  EnhancedValidationResult,
} from "@discovery/EnhancedDiscoveryValidator.ts";

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
  /** Result from enhanced validation (if enabled) */
  enhancedResult?: EnhancedValidationResult;
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
  /** Number of candidates rejected by enhanced validation */
  enhancedRejectionCount: number;
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
  /** Holdout validation options (Issue #1308) */
  holdout?: EnhancedHoldoutOptions;
  /** Brittleness scoring options (Issue #1308) */
  brittleness?: EnhancedBrittlenessOptions;
  /** Enable verbose logging for enhanced validation */
  verbose?: boolean;
  /** Data directory for enhanced validation */
  dataDir?: string;
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
export const STRUCTURAL_CHANGE_TYPES: Set<DiscoveryChangeType> = new Set([
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
export const WEIGHT_ONLY_CHANGE_TYPES: Set<DiscoveryChangeType> = new Set([
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
