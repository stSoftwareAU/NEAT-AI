/**
 * Candidate Filtering Module
 *
 * Filters discovery candidates for evaluation based on failure cache,
 * category diversity, and slot allocation. Also provides weighted
 * roulette-wheel sampling without replacement.
 *
 * Extracted from DiscoveryRunner.ts as part of #1598.
 */

import type { NeatConfig } from "../config/NeatConfig.ts";
import { getLogger } from "@utils/Logger.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { DiscoveryChangeType } from "./DiscoveryCandidates.ts";
import { isCandidateCachedSync } from "./FailureCache.ts";
import { getSuccessfulRemovalNeuronIds } from "./SuccessCache.ts";

export interface FilterCandidatesForEvaluationDeps {
  /**
   * Optional discovery failure cache directory.
   * When provided, cached candidates are filtered out *before* slot allocation.
   */
  failureCacheDir?: string;
  /**
   * Dependency-injected cache checker (defaults to `isCandidateCachedSync`).
   * Inject a stub in tests for determinism and to avoid filesystem access.
   */
  isCandidateCached?: (dir: string, candidate: DiscoveryCandidate) => boolean;
  /**
   * Deterministic RNG injection point (defaults to `Math.random`).
   * Used for weighted sampling and removal shuffling.
   */
  random?: () => number;
  /**
   * Optional discovery success cache directory.
   * When provided, removal candidates whose neuron ID appears in the
   * success cache are deprioritised in favour of novel (untried) candidates.
   */
  successCacheDir?: string;
  /**
   * Dependency-injected success cache query (defaults to `getSuccessfulRemovalNeuronIds`).
   * Inject a stub in tests for determinism and to avoid filesystem access.
   */
  getSuccessfulRemovalIds?: (dir: string) => Set<string>;
}

export interface FilterCandidatesForEvaluationDiagnostics {
  cache?: {
    totalRemoval: number;
    cachedRemoval: number;
    totalOther: number;
    cachedOther: number;
    totalCached: number;
    cachedOtherByType: Map<string, number>;
  };
  categoryDiversity?: Map<string, { selected: number; total: number }>;
  removalSelection?: {
    poolImpacts: string[];
    selectedImpacts: string[];
    /** Number of removal candidates not found in the success cache (preferred). */
    novelCount?: number;
    /** Number of removal candidates deprioritised due to existing success cache entries. */
    alreadySuccessfulCount?: number;
  };
}

/**
 * Filters discovery candidates for evaluation.
 *
 * Goals:
 * - Filter out failure-cached candidates *before* slot allocation, across all types.
 * - Ensure category coverage (add-neurons, add-synapses, change-squash) based on config minimums.
 * - Fill remaining slots using weighted random sampling (expected score improvement), preserving exploration.
 * - Keep removal candidates in their own pool (added on top), using deterministic RNG injection for tests.
 *
 * Note: Rust remains the single source of truth for candidate generation and cost-of-growth gating.
 * TypeScript selection only handles caching, diversity, and evaluation slot allocation.
 */
export function filterCandidatesForEvaluation(
  candidates: DiscoveryCandidate[],
  threadCount: number,
  config: NeatConfig,
  deps: FilterCandidatesForEvaluationDeps = {},
): {
  filtered: DiscoveryCandidate[];
  skipped: Array<{ changeType?: DiscoveryChangeType; expected?: number }>;
  diagnostics?: FilterCandidatesForEvaluationDiagnostics;
} {
  const random = deps.random ?? Math.random;
  const failureCacheDir = deps.failureCacheDir;
  const isCandidateCached = deps.isCandidateCached ?? isCandidateCachedSync;

  const skipped: Array<
    { changeType?: DiscoveryChangeType; expected?: number }
  > = [];
  const diagnostics: FilterCandidatesForEvaluationDiagnostics = {};

  const cacheStats = {
    totalRemoval: 0,
    cachedRemoval: 0,
    totalOther: 0,
    cachedOther: 0,
    cachedOtherByType: new Map<string, number>(),
  };

  const isRemovalType = (type: DiscoveryChangeType): boolean =>
    type === "remove-low-impact" || type === "remove-neuron" ||
    type === "remove-synapse" || type === "cache-informed-removal";

  // Filter cached candidates first so they never consume slots.
  const nonRemovalCandidates: DiscoveryCandidate[] = [];
  const removalCandidates: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const changeType = candidate.change.type;
    const cached = failureCacheDir
      ? isCandidateCached(failureCacheDir, candidate)
      : false;

    if (isRemovalType(changeType)) {
      cacheStats.totalRemoval++;
      if (cached) {
        cacheStats.cachedRemoval++;
        continue;
      }
      removalCandidates.push(candidate);
      continue;
    }

    cacheStats.totalOther++;
    if (cached) {
      cacheStats.cachedOther++;
      cacheStats.cachedOtherByType.set(
        changeType,
        (cacheStats.cachedOtherByType.get(changeType) ?? 0) + 1,
      );
      continue;
    }
    nonRemovalCandidates.push(candidate);
  }

  if (failureCacheDir) {
    const totalCached = cacheStats.cachedRemoval + cacheStats.cachedOther;
    diagnostics.cache = {
      ...cacheStats,
      totalCached,
    };
  }

  // Group non-removal candidates by change type.
  const byCategory = new Map<DiscoveryChangeType, DiscoveryCandidate[]>();
  for (const candidate of nonRemovalCandidates) {
    const type = candidate.change.type;
    const list = byCategory.get(type) ?? [];
    list.push(candidate);
    byCategory.set(type, list);
  }

  // Sort candidates within each category by expected score gain (descending).
  for (const [_type, list] of byCategory) {
    list.sort((a, b) => {
      const aExpected = a.change.expectedErrorReduction;
      const bExpected = b.change.expectedErrorReduction;
      const aScore = Number.isFinite(aExpected) ? (aExpected ?? 0) : 0;
      const bScore = Number.isFinite(bExpected) ? (bExpected ?? 0) : 0;
      if (aScore !== bScore) return bScore - aScore;
      // Keep insertion order stable for ties (important for deterministic behaviour in tests
      // and for preferring the "combined" candidate that is built before its per-item variants).
      return 0;
    });
  }

  // Calculate maxCandidates: scale with CPU, but never below category count so we can keep diversity.
  const maxCandidates = Math.max(2 * threadCount, byCategory.size);

  const minPerCategory = config.discoveryMinCandidatesPerCategory;
  const getCategoryMin = (type: DiscoveryChangeType): number => {
    switch (type) {
      case "add-neurons":
        return minPerCategory.addNeurons;
      case "add-synapses":
        return minPerCategory.addSynapses;
      case "change-squash":
        return minPerCategory.changeSquash;
      case "coordinated-structural":
        // Coordinated structural candidates (Issue #165) are epistatic groups: no
        // single edit improves fitness in isolation, but the group can.
        //
        // These candidates are rare and high signal, so we always reserve at
        // least one evaluation slot when present to avoid starving them under
        // strict per-category minimums.
        return 1;
      default:
        // For combo/other categories we do not force selection; they will be considered by weighting.
        return 0;
    }
  };

  // Phase 1: take minimum from each category.
  const selectedNonRemoval: DiscoveryCandidate[] = [];
  const usedFromCategory = new Map<DiscoveryChangeType, number>();
  for (const [type, list] of byCategory) {
    const minRequired = getCategoryMin(type);
    const toTake = Math.min(minRequired, list.length);
    for (let i = 0; i < toTake; i++) {
      selectedNonRemoval.push(list[i]);
    }
    usedFromCategory.set(type, toTake);
  }

  // Build remaining pool across categories.
  const remainingPool: DiscoveryCandidate[] = [];
  for (const [type, list] of byCategory) {
    const used = usedFromCategory.get(type) ?? 0;
    for (let i = used; i < list.length; i++) {
      remainingPool.push(list[i]);
    }
  }

  const remainingSlots = Math.max(0, maxCandidates - selectedNonRemoval.length);

  // Phase 2: fill remaining slots using weighted sampling (expected improvement).
  const weightOf = (candidate: DiscoveryCandidate): number => {
    const value = candidate.change.expectedErrorReduction;
    if (!Number.isFinite(value)) return 0;
    return value! > 0 ? value! : 0;
  };

  const hasPositiveWeights = remainingPool.some((c) => weightOf(c) > 0);
  const weightedPool = hasPositiveWeights
    ? [...remainingPool].sort((a, b) => weightOf(b) - weightOf(a))
    : remainingPool;

  const sampled = weightedSampleWithoutReplacement(
    weightedPool,
    remainingSlots,
    weightOf,
    random,
  );
  selectedNonRemoval.push(...sampled);

  // Track which remaining were not selected due to slot limits.
  const selectedSet = new Set(selectedNonRemoval);
  for (const candidate of remainingPool) {
    if (!selectedSet.has(candidate)) {
      skipped.push({
        changeType: candidate.change.type,
        expected: candidate.change.expectedErrorReduction,
      });
    }
  }

  // Category diversity diagnostics (non-removal only).
  const categoryDiversity = new Map<
    string,
    { selected: number; total: number }
  >();
  for (const [type, list] of byCategory) {
    const selectedCount = selectedNonRemoval.filter((c) =>
      c.change.type === type
    )
      .length;
    categoryDiversity.set(type, {
      selected: selectedCount,
      total: list.length,
    });
  }
  diagnostics.categoryDiversity = categoryDiversity;

  // Phase 3: select removal candidates from a lowest-impact pool, using injectable RNG.
  // When a success cache directory is available, deprioritise removal candidates
  // whose neuron UUID already has a success cache entry, preferring novel candidates.
  const successCacheDir = deps.successCacheDir;
  const getSuccessIds = deps.getSuccessfulRemovalIds ??
    getSuccessfulRemovalNeuronIds;
  const successfulIds = successCacheDir
    ? getSuccessIds(successCacheDir)
    : undefined;

  const removalSampleSize = Math.min(
    removalCandidates.length,
    minPerCategory.removeLowImpact,
  );

  let selectedRemovalCandidates: DiscoveryCandidate[] = [];
  if (removalSampleSize > 0) {
    if (removalCandidates.length <= removalSampleSize) {
      selectedRemovalCandidates = removalCandidates;

      // Still record success cache diagnostics when all candidates fit.
      if (successfulIds) {
        let novelCount = 0;
        let alreadySuccessfulCount = 0;
        for (const c of removalCandidates) {
          const uuid = c.change.removalCandidate?.neuronUuid ??
            c.change.harmfulNeuronCandidate?.neuronUuid;
          if (uuid !== undefined && successfulIds.has(uuid)) {
            alreadySuccessfulCount++;
          } else {
            novelCount++;
          }
        }
        diagnostics.removalSelection = {
          poolImpacts: [],
          selectedImpacts: [],
          novelCount,
          alreadySuccessfulCount,
        };
      }
    } else {
      const candidatesWithImpact = removalCandidates.map((candidate) => {
        const impactMatch = candidate.change.description?.match(
          /impact:\s*([\d.e+-]+)/i,
        );
        const impact = impactMatch ? parseFloat(impactMatch[1]) : 1e-10;
        return { candidate, impact };
      });

      candidatesWithImpact.sort((a, b) => a.impact - b.impact);

      const TOP_N = Math.max(10, removalSampleSize * 3);
      const topCandidates = candidatesWithImpact.slice(0, TOP_N);

      const poolImpacts = topCandidates.map((c) => c.impact.toExponential(2));

      // Partition the pool into novel vs already-successful candidates.
      let novelPool: typeof topCandidates;
      let alreadySuccessfulPool: typeof topCandidates;
      if (successfulIds) {
        novelPool = [];
        alreadySuccessfulPool = [];
        for (const item of topCandidates) {
          const uuid = item.candidate.change.removalCandidate?.neuronUuid ??
            item.candidate.change.harmfulNeuronCandidate?.neuronUuid;
          if (uuid !== undefined && successfulIds.has(uuid)) {
            alreadySuccessfulPool.push(item);
          } else {
            novelPool.push(item);
          }
        }
      } else {
        novelPool = topCandidates;
        alreadySuccessfulPool = [];
      }

      // Fisher-Yates shuffle on each pool separately.
      for (const pool of [novelPool, alreadySuccessfulPool]) {
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
      }

      // Fill from novel candidates first, then fall back to already-successful.
      const selectedTop: typeof topCandidates = [];
      for (const item of novelPool) {
        if (selectedTop.length >= removalSampleSize) break;
        selectedTop.push(item);
      }
      for (const item of alreadySuccessfulPool) {
        if (selectedTop.length >= removalSampleSize) break;
        selectedTop.push(item);
      }

      selectedRemovalCandidates = selectedTop.map((s) => s.candidate);

      diagnostics.removalSelection = {
        poolImpacts,
        selectedImpacts: selectedTop.map((s) => s.impact.toExponential(2)),
        ...(successfulIds
          ? {
            novelCount: novelPool.length,
            alreadySuccessfulCount: alreadySuccessfulPool.length,
          }
          : {}),
      };

      const selectedRemovalSet = new Set(selectedRemovalCandidates);
      for (const item of candidatesWithImpact) {
        if (!selectedRemovalSet.has(item.candidate)) {
          skipped.push({
            changeType: item.candidate.change.type,
            expected: item.candidate.change.expectedErrorReduction,
          });
        }
      }
    }
  }

  const filtered = [...selectedNonRemoval, ...selectedRemovalCandidates];
  return { filtered, skipped, diagnostics };
}

/**
 * Weighted roulette-wheel sampling without replacement.
 *
 * If all weights are non-finite or <= 0, falls back to uniform random selection.
 */
export function weightedSampleWithoutReplacement<T>(
  items: readonly T[],
  sampleSize: number,
  weightOf: (item: T) => number,
  random: () => number = Math.random,
): T[] {
  const selected: T[] = [];
  if (sampleSize <= 0 || items.length === 0) return selected;

  const pool: T[] = [...items];
  const takeCount = Math.min(sampleSize, pool.length);

  for (let pick = 0; pick < takeCount; pick++) {
    const weights = pool.map((item) => {
      const w = weightOf(item);
      return Number.isFinite(w) && w > 0 ? w : 0;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight <= 0) {
      // Uniform fallback (stable with deterministic RNG).
      const index = Math.floor(random() * pool.length);
      selected.push(pool[index]);
      pool.splice(index, 1);
      continue;
    }

    const r = random() * totalWeight;
    let running = 0;
    let chosenIndex = -1;
    for (let i = 0; i < pool.length; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      running += w;
      if (r <= running) {
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex < 0) {
      // Numerical edge case: select the last positive-weight item.
      for (let i = pool.length - 1; i >= 0; i--) {
        if (weights[i] > 0) {
          chosenIndex = i;
          break;
        }
      }
    }

    if (chosenIndex < 0) {
      // Should never happen, but keep behaviour safe.
      chosenIndex = pool.length - 1;
    }

    selected.push(pool[chosenIndex]);
    pool.splice(chosenIndex, 1);
  }

  return selected;
}

/**
 * Log filtering diagnostics from the candidate filtering result.
 *
 * Reports failure cache hits, category diversity, and removal selection details.
 */
export function logFilteringDiagnostics(
  diagnostics: FilterCandidatesForEvaluationDiagnostics | undefined,
  failureCacheDir: string | undefined,
): void {
  // Log failure cache statistics (cached candidates never consume slots).
  if (diagnostics?.cache && failureCacheDir) {
    const cache = diagnostics.cache;
    if (cache.totalCached > 0) {
      const parts: string[] = [];
      if (cache.cachedRemoval > 0) {
        parts.push(`${cache.cachedRemoval} removal`);
      }
      if (cache.cachedOther > 0) {
        const typeBreakdown = Array.from(cache.cachedOtherByType.entries())
          .map(([type, count]) =>
            `${count} ${type} candidate${count === 1 ? "" : "s"}`
          )
          .join(", ");
        parts.push(typeBreakdown || `${cache.cachedOther} other`);
      }
      getLogger().info(
        `[DiscoveryRunner] ⏭️ Skipped ${cache.totalCached} candidate${
          cache.totalCached === 1 ? "" : "s"
        } due to previous failure: ${parts.join(", ")}`,
      );
    }
  }

  // Log diversity selection summary for non-removal categories.
  if (diagnostics?.categoryDiversity) {
    const diversitySummary = Array.from(
      diagnostics.categoryDiversity.entries(),
    )
      .map(([type, counts]) => `${type}: ${counts.selected}/${counts.total}`)
      .join(", ");
    if (diversitySummary.length > 0) {
      getLogger().info(
        `[DiscoveryRunner] Category diversity: ${diversitySummary}`,
      );
    }
  }

  // Log removal selection diagnostics (lowest-impact pool + chosen impacts).
  if (diagnostics?.removalSelection) {
    const removal = diagnostics.removalSelection;
    if (removal.poolImpacts.length > 0) {
      getLogger().info(
        `[DiscoveryRunner] Top ${removal.poolImpacts.length} lowest-impact removal candidates pool: [${
          removal.poolImpacts.join(", ")
        }]`,
      );
    }
    if (removal.selectedImpacts.length > 0) {
      getLogger().info(
        `[DiscoveryRunner] ✓ Selected ${removal.selectedImpacts.length} removal from top ${removal.poolImpacts.length}: [${
          removal.selectedImpacts.join(", ")
        }]`,
      );
    }

    // Log success cache deprioritisation summary.
    if (
      removal.novelCount !== undefined &&
      removal.alreadySuccessfulCount !== undefined
    ) {
      getLogger().info(
        `[DiscoveryRunner] Removal candidates: ${removal.novelCount} novel, ${removal.alreadySuccessfulCount} already-successful (deprioritised)`,
      );
    }
  }
}
