/**
 * Discovery Failure Cache Module
 *
 * Provides caching for discovery candidates that failed to improve the creature's score.
 * This prevents re-evaluating the same failing candidates when the training dataset
 * hasn't changed.
 *
 * Cache keys are based on:
 * - Change type (add-synapses, add-neurons, remove-low-impact, etc.)
 * - Structural signature (neuron UUIDs, synapse connections)
 * - Weight/bias magnitude (using exponent only, so similar weights map to same key)
 *
 * @module FailureCache
 */

import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { Creature } from "../Creature.ts";

/** Metadata stored alongside cached failures for debugging/analysis */
export interface FailureMetadata {
  originalScore: number;
  candidateScore: number;
  scoreDelta: number;
  error: number;
  /** Re-scored error of the original creature (without candidate changes applied) */
  originalError?: number;
  timestamp?: string;
}

/** Represents the actual neuron state in the creature after changes were applied */
export interface ActualNeuronState {
  uuid: string;
  squash: string;
  bias: number;
}

/** Represents the actual synapse state in the creature after changes were applied */
export interface ActualSynapseState {
  fromUUID: string;
  toUUID: string;
  weight: number;
}

/** Records what actually changed in the creature (for verification against Rust request) */
export interface ActualCreatureChange {
  /** Neurons that were added (with their actual values after fix()) */
  addedNeurons?: ActualNeuronState[];
  /** Synapses connected to added neurons (with actual weights after fix()) */
  addedSynapses?: ActualSynapseState[];
  /** Neurons that were removed */
  removedNeuronUUIDs?: string[];
  /** Synapses that were removed */
  removedSynapseKeys?: string[];
}

/**
 * Extracts the exponent from a number's scientific notation.
 * This allows similar weights (same order of magnitude) to map to the same cache key.
 *
 * @param value - The number to extract the exponent from
 * @returns The exponent (e.g., 0.001 → -3, 100 → 2)
 */
export function extractExponent(value: number): number {
  if (value === 0) return -999; // Sentinel for zero
  const absValue = Math.abs(value);
  return Math.floor(Math.log10(absValue));
}

/**
 * Formats a weight/bias using only its exponent for cache key generation.
 * This ensures that weights with the same order of magnitude produce the same key.
 *
 * @param weight - The weight or bias value
 * @returns A string like "e-3" or "e2"
 */
export function formatWeight(weight: number): string {
  const exp = extractExponent(weight);
  return `e${exp}`;
}

/**
 * Builds a deterministic cache key for a discovery candidate.
 *
 * The key incorporates:
 * - Change type
 * - For neuron removal: just the neuron UUID (simple, fast lookup)
 * - For synapse removal: just the from/to UUIDs
 * - For other types: structural information and weight magnitudes
 *
 * @param candidate - The discovery candidate to generate a key for
 * @returns A string suitable for use as a cache filename
 */
export function buildCacheKey(candidate: DiscoveryCandidate): string {
  const parts: string[] = [candidate.change.type];

  // Handle different candidate types
  switch (candidate.change.type) {
    case "add-neurons": {
      // For add-neurons, use neuronDetails if available
      const details = candidate.change.neuronDetails;
      if (details) {
        parts.push(
          details.fromNeuronUUID,
          details.toNeuronUUID,
          details.squash,
          formatWeight(details.incomingWeight),
          formatWeight(details.outgoingWeight),
          formatWeight(details.bias),
        );
      } else {
        // Fallback: use creature structure
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "remove-low-impact":
    case "remove-neuron": {
      // For neuron removal, prefer the neuron UUID from description.
      // If removal failed once, it won't succeed until the creature structure changes
      // significantly (at which point the cache should be cleared anyway).
      const uuidMatch = candidate.change.description?.match(
        /neuron\s+([a-zA-Z0-9_-]+)/i,
      );
      if (uuidMatch) {
        parts.push(uuidMatch[1]);
      } else {
        // Fallback: use structural signature to avoid cache collisions
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "remove-synapse": {
      // For synapse removal, use from/to UUIDs from synapseDetails.
      // synapseDetails is always set for remove-synapse candidates created by
      // buildDiscoveryCandidates - assert to catch any future code changes.
      const synapseDetails = candidate.change.synapseDetails;
      if (!synapseDetails) {
        throw new Error(
          "remove-synapse candidate missing synapseDetails - this indicates a bug",
        );
      }
      parts.push(synapseDetails.fromNeuronUUID, synapseDetails.toNeuronUUID);
      break;
    }

    case "change-squash": {
      // For squash changes, include the squash function names from description
      // and a structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }

    case "add-synapses":
    default: {
      // For synapses and other types, use structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }
  }

  // Create a safe filename from the key parts
  return sanitiseForFilename(parts.join("_"));
}

/**
 * Builds a structural signature from the creature's neurons and synapses.
 * Uses exponents for weights/biases to group similar structures together.
 *
 * Includes both hidden and output neurons (sorted by UUID for determinism).
 * Input neurons are excluded as they have no squash/bias.
 */
function buildStructuralSignature(candidate: DiscoveryCandidate): string {
  const exported = candidate.creature.exportJSON();
  const sigParts: string[] = [];

  // Include neuron signatures (UUID, squash, bias exponent)
  // Filter to hidden and output neurons, then sort by UUID for determinism
  const relevantNeurons = exported.neurons
    .filter((n) => n.type === "hidden" || n.type === "output")
    .sort((a, b) => a.uuid.localeCompare(b.uuid));

  for (const neuron of relevantNeurons) {
    sigParts.push(
      `n:${neuron.uuid}:${neuron.squash}:${formatWeight(neuron.bias)}`,
    );
  }

  // Include synapse signatures (from→to, weight exponent)
  // Sort for determinism
  const sortedSynapses = [...exported.synapses].sort((a, b) => {
    const keyA = `${a.fromUUID}->${a.toUUID}`;
    const keyB = `${b.fromUUID}->${b.toUUID}`;
    return keyA.localeCompare(keyB);
  });

  for (const synapse of sortedSynapses) {
    sigParts.push(
      `s:${synapse.fromUUID}->${synapse.toUUID}:${
        formatWeight(synapse.weight)
      }`,
    );
  }

  return sigParts.join("|");
}

/**
 * Converts a string to a safe filename by replacing invalid characters.
 */
function sanitiseForFilename(value: string): string {
  // Replace characters not allowed in filenames with underscores
  // Keep alphanumeric, hyphens, underscores, and dots
  return value
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .slice(0, 200); // Limit length for filesystem compatibility
}

/**
 * Gets the cache file path for a candidate.
 */
function getCacheFilePath(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): string {
  const key = buildCacheKey(candidate);
  const typeDir = candidate.change.type;
  return join(cacheDir, typeDir, `${key}.json`);
}

/**
 * Extracts the actual changes made to a creature by comparing with the base creature.
 * This allows verification that the TypeScript side correctly implemented what Rust requested.
 *
 * @param baseCreature - The original creature before changes
 * @param candidateCreature - The creature after changes were applied
 * @returns The actual changes made, or undefined if creatures are identical
 */
export function extractActualCreatureChanges(
  baseCreature: Creature,
  candidateCreature: Creature,
): ActualCreatureChange | undefined {
  const baseJSON = baseCreature.exportJSON();
  const candidateJSON = candidateCreature.exportJSON();

  // Build sets for comparison
  const baseNeuronUUIDs = new Set(baseJSON.neurons.map((n) => n.uuid));
  const candidateNeuronUUIDs = new Set(
    candidateJSON.neurons.map((n) => n.uuid),
  );

  const baseSynapseKeys = new Set(
    baseJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
  );
  const candidateSynapseKeys = new Set(
    candidateJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
  );

  // Find added neurons (in candidate but not in base)
  const addedNeurons: ActualNeuronState[] = [];
  for (const neuron of candidateJSON.neurons) {
    if (
      !baseNeuronUUIDs.has(neuron.uuid) &&
      neuron.type === "hidden" &&
      neuron.squash // Skip neurons without squash (shouldn't happen for hidden)
    ) {
      addedNeurons.push({
        uuid: neuron.uuid,
        squash: neuron.squash,
        bias: neuron.bias,
      });
    }
  }

  // Find added synapses (in candidate but not in base)
  const addedSynapses: ActualSynapseState[] = [];
  for (const synapse of candidateJSON.synapses) {
    const key = `${synapse.fromUUID}->${synapse.toUUID}`;
    if (!baseSynapseKeys.has(key)) {
      addedSynapses.push({
        fromUUID: synapse.fromUUID,
        toUUID: synapse.toUUID,
        weight: synapse.weight,
      });
    }
  }

  // Find removed neurons (in base but not in candidate)
  const removedNeuronUUIDs: string[] = [];
  for (const neuron of baseJSON.neurons) {
    if (!candidateNeuronUUIDs.has(neuron.uuid) && neuron.type === "hidden") {
      removedNeuronUUIDs.push(neuron.uuid);
    }
  }

  // Find removed synapses (in base but not in candidate)
  const removedSynapseKeys: string[] = [];
  for (const synapse of baseJSON.synapses) {
    const key = `${synapse.fromUUID}->${synapse.toUUID}`;
    if (!candidateSynapseKeys.has(key)) {
      removedSynapseKeys.push(key);
    }
  }

  // Return undefined if nothing changed
  if (
    addedNeurons.length === 0 &&
    addedSynapses.length === 0 &&
    removedNeuronUUIDs.length === 0 &&
    removedSynapseKeys.length === 0
  ) {
    return undefined;
  }

  return {
    addedNeurons: addedNeurons.length > 0 ? addedNeurons : undefined,
    addedSynapses: addedSynapses.length > 0 ? addedSynapses : undefined,
    removedNeuronUUIDs: removedNeuronUUIDs.length > 0
      ? removedNeuronUUIDs
      : undefined,
    removedSynapseKeys: removedSynapseKeys.length > 0
      ? removedSynapseKeys
      : undefined,
  };
}

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
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = await Deno.stat(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    console.warn(
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
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = Deno.statSync(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    console.warn(
      `[FailureCache] Error checking cache for candidate: ${error}`,
    );
    return false;
  }
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
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);

    // Ensure directory exists
    await Deno.mkdir(dir, { recursive: true });

    // Write cache entry with metadata and candidate details
    const cacheEntry: Record<string, unknown> = {
      key: buildCacheKey(candidate),
      changeType: candidate.change.type,
      description: candidate.change.description,
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    // Include neuronDetails if available (for add-neurons candidates)
    // This is what Rust requested
    if (candidate.change.neuronDetails) {
      cacheEntry.rustRequest = {
        neuronDetails: candidate.change.neuronDetails,
      };
    }

    // Include synapseDetails if available (for remove-synapse candidates)
    if (candidate.change.synapseDetails) {
      cacheEntry.synapseDetails = candidate.change.synapseDetails;
    }

    // Include expected error reduction if available
    if (candidate.change.expectedErrorReduction !== undefined) {
      cacheEntry.expectedErrorReduction =
        candidate.change.expectedErrorReduction;
    }

    // Include sample size if available
    if (candidate.change.sampleSize !== undefined) {
      cacheEntry.sampleSize = candidate.change.sampleSize;
    }

    // Compute and include actual error reduction if both errors are finite
    // actualErrorReduction = originalError - candidateError (positive means improvement)
    // Skip if either error is non-finite (NaN, Infinity) as this indicates evaluation issues
    if (
      metadata.originalError !== undefined &&
      Number.isFinite(metadata.originalError) &&
      Number.isFinite(metadata.error)
    ) {
      const actualErrorReduction = metadata.originalError - metadata.error;
      cacheEntry.actualErrorReduction = actualErrorReduction;
    }

    // Extract and include actual creature changes for verification
    // This is what TypeScript actually created (after fix() etc.)
    if (baseCreature) {
      const actualChanges = extractActualCreatureChanges(
        baseCreature,
        candidate.creature,
      );
      if (actualChanges) {
        cacheEntry.actualCreatureChange = actualChanges;
      }
    }

    await Deno.writeTextFile(filePath, JSON.stringify(cacheEntry, null, 2));
  } catch (error) {
    // Log but don't fail - caching is an optimisation, not critical
    console.warn(
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
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);

    // Ensure directory exists
    Deno.mkdirSync(dir, { recursive: true });

    // Write cache entry with metadata and candidate details
    const cacheEntry: Record<string, unknown> = {
      key: buildCacheKey(candidate),
      changeType: candidate.change.type,
      description: candidate.change.description,
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    // Include neuronDetails if available (for add-neurons candidates)
    // This is what Rust requested
    if (candidate.change.neuronDetails) {
      cacheEntry.rustRequest = {
        neuronDetails: candidate.change.neuronDetails,
      };
    }

    // Include synapseDetails if available (for remove-synapse candidates)
    if (candidate.change.synapseDetails) {
      cacheEntry.synapseDetails = candidate.change.synapseDetails;
    }

    // Include expected error reduction if available
    if (candidate.change.expectedErrorReduction !== undefined) {
      cacheEntry.expectedErrorReduction =
        candidate.change.expectedErrorReduction;
    }

    // Include sample size if available
    if (candidate.change.sampleSize !== undefined) {
      cacheEntry.sampleSize = candidate.change.sampleSize;
    }

    // Compute and include actual error reduction if both errors are finite
    // actualErrorReduction = originalError - candidateError (positive means improvement)
    // Skip if either error is non-finite (NaN, Infinity) as this indicates evaluation issues
    if (
      metadata.originalError !== undefined &&
      Number.isFinite(metadata.originalError) &&
      Number.isFinite(metadata.error)
    ) {
      const actualErrorReduction = metadata.originalError - metadata.error;
      cacheEntry.actualErrorReduction = actualErrorReduction;
    }

    // Extract and include actual creature changes for verification
    // This is what TypeScript actually created (after fix() etc.)
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
  } catch (error) {
    // Log but don't fail - caching is an optimisation, not critical
    console.warn(
      `[FailureCache] Failed to record failure for candidate ${candidate.change.type}: ${error}`,
    );
  }
}

/**
 * Filters candidates, removing those that are already cached as failures.
 *
 * @param cacheDir - The cache directory path (if undefined, no filtering is done)
 * @param candidates - The candidates to filter
 * @returns Object with filtered candidates and count of skipped candidates
 */
export function filterCachedCandidates(
  cacheDir: string | undefined,
  candidates: DiscoveryCandidate[],
): { filtered: DiscoveryCandidate[]; cachedCount: number } {
  if (!cacheDir) {
    return { filtered: candidates, cachedCount: 0 };
  }

  const filtered: DiscoveryCandidate[] = [];
  let cachedCount = 0;

  for (const candidate of candidates) {
    if (isCandidateCachedSync(cacheDir, candidate)) {
      cachedCount++;
    } else {
      filtered.push(candidate);
    }
  }

  return { filtered, cachedCount };
}
