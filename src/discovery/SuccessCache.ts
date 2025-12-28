/**
 * Discovery Success Cache Module
 *
 * Persists discovery candidates that previously improved a creature's score.
 * This lets long-running workflows quickly re-apply known wins to the current
 * fittest creature, even if evolution has progressed since the discovery run.
 *
 * The cache is intended for stable datasets. If the dataset changes materially,
 * delete the cache directory to avoid replaying stale signals.
 *
 * Notes:
 * - Keys reuse the same `buildCacheKey()` logic as the failure cache so behaviour
 *   stays consistent across both caches.
 * - We store `actualCreatureChange` (computed by comparing base vs candidate) so
 *   replay logic can be deterministic and debuggable.
 */

import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";
import { getDiscoveryVersion } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { Creature } from "../Creature.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import { buildCacheKey, extractActualCreatureChanges } from "./FailureCache.ts";

/** Metadata stored alongside cached successes for debugging/analysis */
export interface SuccessMetadata {
  originalScore: number;
  candidateScore: number;
  scoreDelta: number;
  /** Re-scored error of the original creature (without candidate changes applied) */
  originalError?: number;
  /** Re-scored error of the candidate creature (with changes applied) */
  error: number;
  timestamp?: string;
  /** NEAT-AI-Discovery library version that generated the candidate */
  discoveryVersion?: string;
}

export interface SuccessCacheEntry extends SuccessMetadata {
  key: string;
  changeType: string;
  description?: string;
  rustRequest?: Record<string, unknown>;
  actualCreatureChange?: unknown;
}

/**
 * Converts a string to a safe filename by replacing invalid characters.
 *
 * Kept consistent with the failure cache to avoid platform-specific surprises.
 */
function sanitiseForFilename(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 200);
}

function getCacheFilePath(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): string {
  const key = sanitiseForFilename(buildCacheKey(candidate));
  const typeDir = sanitiseForFilename(candidate.change.type);
  return join(cacheDir, typeDir, `${key}.json`);
}

function buildRustRequest(
  candidate: DiscoveryCandidate,
): Record<string, unknown> {
  const request: Record<string, unknown> = {};

  if (candidate.change.neuronDetails) {
    request.neuronDetails = candidate.change.neuronDetails;
  }
  if (candidate.change.neuronCandidate) {
    request.neuronCandidate = candidate.change.neuronCandidate;
  }
  if (candidate.change.splitSynapseInsertNeuronCandidate) {
    request.splitSynapseInsertNeuronCandidate =
      candidate.change.splitSynapseInsertNeuronCandidate;
  }
  if (candidate.change.synapseCandidate) {
    request.synapseCandidate = candidate.change.synapseCandidate;
  }
  if (candidate.change.squashCandidate) {
    request.squashCandidate = candidate.change.squashCandidate;
  }
  if (candidate.change.removalCandidate) {
    request.removalCandidate = candidate.change.removalCandidate;
  }
  if (candidate.change.harmfulNeuronCandidate) {
    request.harmfulNeuronCandidate = candidate.change.harmfulNeuronCandidate;
  }
  if (candidate.change.harmfulSynapseCandidate) {
    request.harmfulSynapseCandidate = candidate.change.harmfulSynapseCandidate;
  }
  if (candidate.change.synapseDetails) {
    request.synapseDetails = candidate.change.synapseDetails;
  }

  return request;
}

/**
 * Records a discovery candidate as a success in the cache.
 *
 * @param cacheDir - Cache directory path
 * @param candidate - Candidate that improved score
 * @param metadata - Additional metadata about the success
 * @param baseCreature - Base creature for extracting the actual changes
 */
export function recordSuccessSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
  metadata: SuccessMetadata,
  baseCreature?: Creature,
): void {
  const filePath = getCacheFilePath(cacheDir, candidate);
  const dir = dirname(filePath);

  Deno.mkdirSync(dir, { recursive: true });

  const discoveryVersion = getDiscoveryVersion();
  const cacheEntry: SuccessCacheEntry = {
    key: buildCacheKey(candidate),
    changeType: candidate.change.type,
    description: candidate.change.description,
    ...metadata,
    timestamp: metadata.timestamp ?? new Date().toISOString(),
    ...(discoveryVersion ? { discoveryVersion } : {}),
    rustRequest: buildRustRequest(candidate),
  };

  if (baseCreature) {
    const actualChanges = extractActualCreatureChanges(
      baseCreature,
      candidate.creature,
    );
    if (actualChanges) {
      cacheEntry.actualCreatureChange = actualChanges;
    }
  }

  Deno.writeTextFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
}

/**
 * Deletes a cached success entry for the provided candidate.
 */
export function deleteSuccessSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): void {
  const filePath = getCacheFilePath(cacheDir, candidate);
  try {
    Deno.removeSync(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}

/**
 * Deletes a cached success entry by changeType + key.
 *
 * This is used by the replay runner, which operates on persisted cache entries
 * rather than in-memory `DiscoveryCandidate` instances.
 */
export function deleteSuccessByKeySync(
  cacheDir: string,
  changeType: string,
  key: string,
): void {
  const filePath = join(
    cacheDir,
    sanitiseForFilename(changeType),
    `${sanitiseForFilename(key)}.json`,
  );
  try {
    Deno.removeSync(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}

/**
 * Lists all cached success entries under a cache directory.
 *
 * Best-effort: corrupt files are skipped with a warning.
 */
export function listSuccessEntriesSync(cacheDir: string): SuccessCacheEntry[] {
  const results: SuccessCacheEntry[] = [];
  try {
    for (const typeDir of Deno.readDirSync(cacheDir)) {
      if (!typeDir.isDirectory) continue;
      const typePath = join(cacheDir, typeDir.name);
      for (const entry of Deno.readDirSync(typePath)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        const filePath = join(typePath, entry.name);
        try {
          const parsed = JSON.parse(
            Deno.readTextFileSync(filePath),
          ) as SuccessCacheEntry;
          if (
            typeof parsed?.key === "string" &&
            typeof parsed?.changeType === "string"
          ) {
            results.push(parsed);
          }
        } catch (error) {
          console.warn(
            `[SuccessCache] Failed to parse success cache entry '${filePath}':`,
            error,
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
  return results;
}
