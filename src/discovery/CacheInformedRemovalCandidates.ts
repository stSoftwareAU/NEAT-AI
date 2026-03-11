/**
 * Cache-Informed Removal Candidates Module
 *
 * Builds multi-neuron removal candidates from the success cache.
 * The success cache tracks which individual neuron removals have succeeded
 * historically. This module uses that data to proactively build candidates
 * that remove combinations of 2-3 neurons in Phase 1, rather than waiting
 * for Phase 2 (which requires 2+ successful singles in the *current* run).
 *
 * Issue #1731: Enhancement to build multi-neuron removal candidates from
 * success cache data.
 */

import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Creature } from "../Creature.ts";
import { getLogger } from "../utils/Logger.ts";
import { createSeededRng } from "../utils/RandomNumberGenerator.ts";
import { shortID } from "./CandidateDescriptions.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import {
  getSuccessfulRemovalDetails,
  type SuccessfulRemovalDetail,
} from "./SuccessCache.ts";

/** Maximum number of pair combinations to generate. */
const MAX_PAIR_CANDIDATES = 10;

/** Maximum number of triple combinations to generate. */
const MAX_TRIPLE_CANDIDATES = 6;

/**
 * Builds multi-neuron removal candidates informed by the success cache.
 *
 * Queries `getSuccessfulRemovalDetails()` for neurons that have been
 * successfully removed in past discovery runs, filters to those still
 * present in the base creature, then builds candidates that remove
 * combinations of 2-3 neurons simultaneously.
 *
 * Uses a seeded RNG for reproducible sampling when there are many
 * possible combinations.
 *
 * @param baseCreature The creature to apply removals to
 * @param successCacheDir Root success cache directory (undefined = skip)
 * @param seed Optional seed for reproducible combination sampling
 * @param discoveryFailureCacheDir Optional failure cache directory
 * @returns Array of multi-neuron removal candidates
 */
export function buildCacheInformedRemovalCandidates(
  baseCreature: Creature,
  successCacheDir: string | undefined,
  seed?: number,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!successCacheDir) return [];

  const allDetails = getSuccessfulRemovalDetails(successCacheDir);
  if (allDetails.length === 0) return [];

  // Filter to neurons that still exist in the base creature
  const creatureNeuronUUIDs = new Set(
    baseCreature.neurons.map((n) => n.uuid),
  );
  const matchingDetails = allDetails.filter((d) =>
    creatureNeuronUUIDs.has(d.neuronUUID)
  );

  if (matchingDetails.length < 2) {
    if (matchingDetails.length === 1) {
      getLogger().info(
        `[CacheInformedRemoval] Only 1 cached removal neuron exists in creature; need at least 2 for combinations`,
      );
    }
    return [];
  }

  // Sort by scoreDelta descending so highest-impact removals are tried first
  matchingDetails.sort((a, b) => b.scoreDelta - a.scoreDelta);

  const rng = createSeededRng(seed ?? 1731);
  const candidates: DiscoveryCandidate[] = [];

  // Build pair combinations (2 neurons)
  const pairCombinations = generateCombinations(
    matchingDetails,
    2,
    rng,
    MAX_PAIR_CANDIDATES,
  );
  for (const combo of pairCombinations) {
    const candidate = buildMultiRemovalCandidate(
      baseCreature,
      combo,
      discoveryFailureCacheDir,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Build triple combinations (3 neurons) if enough cached removals exist
  if (matchingDetails.length >= 3) {
    const tripleCombinations = generateCombinations(
      matchingDetails,
      3,
      rng,
      MAX_TRIPLE_CANDIDATES,
    );
    for (const combo of tripleCombinations) {
      const candidate = buildMultiRemovalCandidate(
        baseCreature,
        combo,
        discoveryFailureCacheDir,
      );
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length > 0) {
    getLogger().info(
      `[CacheInformedRemoval] Built ${candidates.length} cache-informed removal candidate${
        candidates.length === 1 ? "" : "s"
      } from ${matchingDetails.length} historically successful removals`,
    );
  }

  return candidates;
}

/**
 * Generates combinations of the given size from the details array.
 *
 * When the total number of possible combinations exceeds `maxCount`,
 * uses the seeded RNG to sample a reproducible subset.
 */
function generateCombinations(
  details: SuccessfulRemovalDetail[],
  size: number,
  rng: { random(): number },
  maxCount: number,
): SuccessfulRemovalDetail[][] {
  const n = details.length;

  // Calculate total possible combinations: C(n, size)
  const totalCombinations = binomialCoefficient(n, size);

  if (totalCombinations <= maxCount) {
    // Generate all combinations
    return allCombinations(details, size);
  }

  // Sample a subset using seeded RNG
  return sampleCombinations(details, size, maxCount, rng);
}

/**
 * Generates all combinations of the given size from the array.
 */
function allCombinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  function recurse(start: number, current: T[]): void {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]);
      recurse(i + 1, current);
      current.pop();
    }
  }

  recurse(0, []);
  return result;
}

/**
 * Samples up to `count` unique combinations using the seeded RNG.
 *
 * Uses Fisher-Yates on indices to ensure no duplicate combinations.
 */
function sampleCombinations<T>(
  items: T[],
  size: number,
  count: number,
  rng: { random(): number },
): T[][] {
  const n = items.length;
  const result: T[][] = [];
  const seen = new Set<string>();

  // Generate combinations by sampling random index sets
  const maxAttempts = count * 3;
  for (
    let attempt = 0;
    attempt < maxAttempts && result.length < count;
    attempt++
  ) {
    // Pick `size` distinct random indices
    const indices = sampleIndices(n, size, rng);
    const key = indices.join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    result.push(indices.map((i) => items[i]));
  }

  return result;
}

/**
 * Samples `count` distinct indices from [0, n) using the RNG.
 * Returns sorted indices for deterministic combination keys.
 */
function sampleIndices(
  n: number,
  count: number,
  rng: { random(): number },
): number[] {
  const indices: number[] = [];
  const available = Array.from({ length: n }, (_, i) => i);

  for (let i = 0; i < count; i++) {
    const pick = Math.floor(rng.random() * available.length);
    indices.push(available[pick]);
    // Remove picked index by swapping with last element
    available[pick] = available[available.length - 1];
    available.pop();
  }

  return indices.sort((a, b) => a - b);
}

/**
 * Computes the binomial coefficient C(n, k).
 */
function binomialCoefficient(n: number, k: number): number {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;

  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Builds a single candidate creature by sequentially removing multiple neurons.
 *
 * Uses `DiscoverStructure.removeLowImpactNeuron()` for each neuron in the
 * combination to leverage existing bias-compensation and validation logic.
 */
function buildMultiRemovalCandidate(
  baseCreature: Creature,
  details: SuccessfulRemovalDetail[],
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate | undefined {
  let creature: Creature = baseCreature;
  const removedUUIDs: string[] = [];

  for (const detail of details) {
    // Check neuron still exists in the (progressively modified) creature
    const neuronExists = creature.neurons.some(
      (n) => n.uuid === detail.neuronUUID,
    );
    if (!neuronExists) continue;

    const removed = DiscoverStructure.removeLowImpactNeuron(
      "cache-informed",
      creature,
      {
        neuronUUID: detail.neuronUUID,
        totalError: 0, // Historical; actual impact evaluated at scoring time
        impact: 0, // Historical; not used for bias compensation
        reason: "cache-informed-removal",
      },
      discoveryFailureCacheDir,
    );

    if (removed) {
      creature = removed;
      removedUUIDs.push(detail.neuronUUID);
    }
  }

  // Need at least 2 successful removals for a multi-neuron candidate
  if (removedUUIDs.length < 2) return undefined;

  const shortUUIDs = removedUUIDs.map((uuid) => shortID(uuid)).join(", ");
  return {
    creature,
    change: {
      type: "cache-informed-removal",
      description:
        `🗂️ Removed ${removedUUIDs.length} neurons (cache-informed: ${shortUUIDs})`,
    },
  };
}
