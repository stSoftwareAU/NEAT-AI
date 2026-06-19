/**
 * Discovery Failure Cache Module
 *
 * Provides caching for discovery candidates that failed to improve the creature's score.
 * This prevents re-evaluating the same failing candidates when the training dataset
 * hasn't changed.
 *
 * Cache key logic extracted to FailureCacheKey.ts.
 * Diagnostic/extraction logic extracted to FailureCacheDiagnostics.ts.
 * Type definitions extracted to FailureCacheTypes.ts.
 *
 * @module FailureCache
 */

import { dirname } from "@std/path/dirname";
import { getDiscoveryVersion } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { getLogger } from "@utils/Logger.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import type { Creature } from "@creature";
import {
  extractActualCreatureChanges,
  extractPredictionDetails,
  extractTargetNeuronInfo,
  logPredictionTrace,
} from "@discovery/FailureCacheDiagnostics.ts";
import { buildCacheKey, getCacheFilePath } from "@discovery/FailureCacheKey.ts";
import type { FailureMetadata } from "@discovery/FailureCacheTypes.ts";
import {
  buildDiscoveryWireRequest,
  DISCOVERY_WIRE_SCHEMA_VERSION,
} from "@discovery/DiscoveryWireFormat.ts";
import { indexCandidateForCache } from "@discovery/SubnetworkHashIndex.ts";

// Re-export for backward compatibility.
export { isPredictionTracingEnabled } from "@discovery/FailureCacheDiagnostics.ts";
export {
  extractActualCreatureChanges,
  extractPredictionDetails,
  extractTargetNeuronInfo,
  logPredictionTrace,
} from "@discovery/FailureCacheDiagnostics.ts";
export {
  buildCacheKey,
  extractExponent,
  formatWeight,
} from "@discovery/FailureCacheKey.ts";
export type {
  ActualCreatureChange,
  ActualNeuronState,
  ActualSynapseState,
  FailureMetadata,
  PredictionDetails,
  SampleDiagnostic,
  TargetNeuronInfo,
} from "@discovery/FailureCacheTypes.ts";

/**
 * Checks if a discovery candidate is already cached as a failure.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate to check
 * @returns true if the candidate was previously cached as a failure
 */
export async function isCandidateCached(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): Promise<boolean> {
  // Combo candidates are derived from previously successful singles and are
  // highly dependent on the *current* base creature. Caching them as failures
  // can permanently suppress sensible re-tries as the creature evolves.
  //
  // Exception (30-Dec-2025): `combo-successful` is generated in phase 2 from
  // the set of successful single-step candidates. It is still keyed by the
  // resulting creature structure (see buildCacheKey fallback), so it will only
  // be considered cached when the exact same combined outcome is re-proposed.
  //
  // This keeps the failure cache useful for repeated discovery runs on a stable
  // creature while avoiding broad caching of other combo-* types.
  if (
    candidate.change.type.startsWith("combo-") &&
    candidate.change.type !== "combo-successful"
  ) {
    return false;
  }
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = await Deno.stat(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    getLogger().warn(
      `[FailureCache] Error checking cache for candidate: ${error}`,
    );
    return false;
  }
}

/**
 * Synchronously checks if a discovery candidate is already cached as a failure.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate to check
 * @returns true if the candidate was previously cached as a failure
 */
export function isCandidateCachedSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): boolean {
  // See async variant for rationale.
  if (
    candidate.change.type.startsWith("combo-") &&
    candidate.change.type !== "combo-successful"
  ) {
    return false;
  }
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = Deno.statSync(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    getLogger().warn(
      `[FailureCache] Error checking cache for candidate: ${error}`,
    );
    return false;
  }
}

/**
 * Builds the cache entry payload shared by both async and sync record functions.
 */
function buildCacheEntryPayload(
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  baseCreature: Creature | undefined,
): Record<string, unknown> {
  const discoveryVersion = getDiscoveryVersion();

  const cacheEntry: Record<string, unknown> = {
    wireSchemaVersion: DISCOVERY_WIRE_SCHEMA_VERSION,
    key: buildCacheKey(candidate),
    changeType: candidate.change.type,
    description: candidate.change.description,
    ...metadata,
    timestamp: Temporal.Now.instant().toString(),
    ...(discoveryVersion ? { discoveryVersion } : {}),
  };

  if (baseCreature) {
    cacheEntry.rustRequest = buildDiscoveryWireRequest(baseCreature, candidate);
  }

  if (
    cacheEntry.rustRequest &&
    typeof cacheEntry.rustRequest === "object" &&
    "synapseDetails" in cacheEntry.rustRequest
  ) {
    cacheEntry.synapseDetails = (cacheEntry.rustRequest as {
      synapseDetails?: unknown;
    }).synapseDetails;
  }

  if (candidate.change.expectedErrorReduction !== undefined) {
    cacheEntry.expectedErrorReduction = candidate.change.expectedErrorReduction;
  }

  if (candidate.change.sampleSize !== undefined) {
    cacheEntry.sampleSize = candidate.change.sampleSize;
  }

  if (
    metadata.originalError !== undefined &&
    Number.isFinite(metadata.originalError) &&
    Number.isFinite(metadata.error)
  ) {
    const actualErrorReduction = metadata.originalError - metadata.error;
    cacheEntry.actualErrorReduction = actualErrorReduction;
  }

  if (baseCreature) {
    const actualChanges = extractActualCreatureChanges(
      baseCreature,
      candidate.creature,
    );
    if (actualChanges) {
      cacheEntry.actualCreatureChange = actualChanges;
    }

    const predictionDetails = extractPredictionDetails(candidate);
    if (predictionDetails) {
      cacheEntry.predictionDetails = predictionDetails;
    }

    const targetNeuronInfo = extractTargetNeuronInfo(
      candidate,
      baseCreature,
    );
    if (targetNeuronInfo) {
      cacheEntry.targetNeuronInfo = targetNeuronInfo;
    }
  }

  logPredictionTrace(candidate, metadata, cacheEntry);

  return cacheEntry;
}

/**
 * Records a discovery candidate as a failure in the cache.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate that failed to improve
 * @param metadata - Additional metadata about the failure
 * @param baseCreature - Optional base creature to compare against for extracting actual changes
 */
export async function recordFailure(
  cacheDir: string,
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  baseCreature?: Creature,
): Promise<void> {
  if (
    candidate.change.type.startsWith("combo-") &&
    candidate.change.type !== "combo-successful"
  ) {
    return;
  }
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);
    await Deno.mkdir(dir, { recursive: true });

    const cacheEntry = buildCacheEntryPayload(
      candidate,
      metadata,
      baseCreature,
    );
    await Deno.writeTextFile(filePath, JSON.stringify(cacheEntry, null, 2));

    // Issue #2531: also index by subnetwork hash for O(1) lookup.
    indexCandidateForCache(baseCreature, candidate, {
      source: "failure",
      changeType: candidate.change.type,
      cacheKey: String(cacheEntry.key),
    });
  } catch (error) {
    getLogger().warn(
      `[FailureCache] Failed to record failure for candidate ${candidate.change.type}: ${error}`,
    );
  }
}

/**
 * Synchronously records a discovery candidate as a failure in the cache.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate that failed to improve
 * @param metadata - Additional metadata about the failure
 * @param baseCreature - Optional base creature to compare against for extracting actual changes
 */
export function recordFailureSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  baseCreature?: Creature,
): void {
  if (
    candidate.change.type.startsWith("combo-") &&
    candidate.change.type !== "combo-successful"
  ) {
    return;
  }
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);
    Deno.mkdirSync(dir, { recursive: true });

    const cacheEntry = buildCacheEntryPayload(
      candidate,
      metadata,
      baseCreature,
    );
    Deno.writeTextFileSync(filePath, JSON.stringify(cacheEntry, null, 2));

    // Issue #2531: also index by subnetwork hash for O(1) lookup.
    indexCandidateForCache(baseCreature, candidate, {
      source: "failure",
      changeType: candidate.change.type,
      cacheKey: String(cacheEntry.key),
    });
  } catch (error) {
    getLogger().warn(
      `[FailureCache] Failed to record failure for candidate ${candidate.change.type}: ${error}`,
    );
  }
}
