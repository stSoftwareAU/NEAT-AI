import type { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { DiscoveryError } from "@errors/DiscoveryError.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import {
  BatchDiscoveryValidator,
  type BatchValidationResult,
  type BatchValidationStats,
  type BatchValidatorOptions,
} from "@discovery/BatchDiscoveryValidator.ts";

/**
 * Validate a creature immediately after applying discovery changes.
 *
 * Fail fast near the discovery logic that introduced corruption, rather than
 * surfacing later during unrelated phases (e.g. breeding).
 *
 * Forward-only is enforced when the discovered creature is marked forwardOnly.
 * All creatures are 4.x; the forwardOnly flag is the source of truth.
 */
export function validateAfterDiscoveryOrThrow(args: {
  baseCreature: Creature;
  discoveredCreature: Creature;
  discoveryID: string;
  operation: string;
  feedbackLoop: boolean | undefined;
}): void {
  const {
    baseCreature,
    discoveredCreature,
    discoveryID,
    operation,
  } = args;

  const enforceForwardOnly = baseCreature.forwardOnly === true ||
    discoveredCreature.forwardOnly === true;

  try {
    if (enforceForwardOnly) {
      creatureValidate(discoveredCreature, { forwardOnly: true });
      discoveredCreature.forwardOnly = true;
    } else {
      creatureValidate(discoveredCreature);
    }
  } catch (e) {
    const error = e as Error;
    const violations = enforceForwardOnly
      ? sampleForwardOnlyViolations(discoveredCreature, 10)
      : [];

    const detail = violations.length > 0
      ? ` Violations(sample up to 10): ${violations.join(" | ")}`
      : "";

    throw new DiscoveryError(
      `[Discovery ${discoveryID}] CRITICAL: discovery operation '${operation}' produced an invalid creature. ` +
        `base=${
          baseCreature.uuid ?? "unknown"
        } (v${baseCreature.semanticVersion}, forwardOnly=${
          baseCreature.forwardOnly === true
        }), ` +
        `result=${
          discoveredCreature.uuid ?? "unknown"
        } (v${discoveredCreature.semanticVersion}, forwardOnly=${
          discoveredCreature.forwardOnly === true
        }). ` +
        `Error=${error.name}: ${error.message}.${detail}`,
      "INVALID_CREATURE",
    );
  }
}

function sampleForwardOnlyViolations(
  creature: Creature,
  limit: number,
): string[] {
  const out: string[] = [];
  const synapses = creature.synapses;
  for (let i = 0; i < synapses.length && out.length < limit; i++) {
    const s = synapses[i];
    if (s.from === s.to || s.from > s.to) {
      out.push(
        `${i}) ${s.from} (${
          creature.neurons[s.from]?.ID?.() ?? "?"
        }) -> ${s.to} (${creature.neurons[s.to]?.ID?.() ?? "?"})`,
      );
    }
  }
  return out;
}

/**
 * Validate multiple discovery candidates in a batch.
 *
 * This function provides batch validation for discovery candidates, reducing
 * the overhead of individual validation calls by:
 * 1. Grouping candidates by type (structural vs weight-only changes)
 * 2. Validating structural candidates with early-exit on first invalid
 * 3. Caching common validation results across candidates
 *
 * Issue #1291 - Performance: Batch discovery candidate validation
 *
 * @param args - Batch validation arguments
 * @returns Batch validation results with statistics
 */
export function validateDiscoveryCandidatesBatch(args: {
  /** The base creature the candidates were derived from */
  baseCreature: Creature;
  /** The candidates to validate */
  candidates: DiscoveryCandidate[];
  /** Discovery session ID (for log correlation) */
  discoveryID: string;
  /** The config feedbackLoop flag for the current run */
  feedbackLoop: boolean | undefined;
  /** Whether to exit early on first structural validation failure */
  earlyExitOnStructuralFailure?: boolean;
}): {
  results: BatchValidationResult[];
  stats: BatchValidationStats;
  validCandidates: DiscoveryCandidate[];
  invalidCandidates: DiscoveryCandidate[];
} {
  const {
    baseCreature,
    candidates,
    feedbackLoop,
    earlyExitOnStructuralFailure,
  } = args;

  const options: BatchValidatorOptions = {
    feedbackLoop: feedbackLoop ?? false,
    earlyExitOnStructuralFailure: earlyExitOnStructuralFailure ?? false,
  };

  const validator = new BatchDiscoveryValidator(options);
  const results = validator.validateBatch(baseCreature, candidates);
  const stats = validator.getStats();

  // Separate valid and invalid candidates for convenience
  const validCandidates: DiscoveryCandidate[] = [];
  const invalidCandidates: DiscoveryCandidate[] = [];

  for (const result of results) {
    if (result.valid) {
      validCandidates.push(result.candidate);
    } else {
      invalidCandidates.push(result.candidate);
    }
  }

  return {
    results,
    stats,
    validCandidates,
    invalidCandidates,
  };
}

/**
 * Re-export batch validation types for convenience.
 */
export type {
  BatchValidationResult,
  BatchValidationStats,
  BatchValidatorOptions,
};
export { BatchDiscoveryValidator };
