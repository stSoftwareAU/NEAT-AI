/**
 * WASM Cache Pre-Warmer
 *
 * Issue #2287 - Pre-warm WASM compilation cache before fitness evaluation.
 *
 * After breeding and mutation produce new offspring, we know the full set of
 * creature topologies before fitness evaluation begins. This module pre-computes
 * topology hashes and pre-compiles WASM templates for unique topologies that
 * are not already in the LRU cache.
 *
 * Benefits:
 * - Topology hashes are cached on each creature, eliminating lazy computation
 *   during Fitness.calculate()'s topology grouping sort.
 * - WASM compilation templates are pre-built in the main thread's cache,
 *   avoiding cold-start compilation overhead.
 * - Only unique topologies are compiled, keeping cache pressure minimal.
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { isWasmEligible } from "@creature/CreatureActivation.ts";
import {
  ensureWasmTemplate,
  hasWasmTemplate,
} from "@wasm/WasmCompilationCache.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";

/**
 * Result of a pre-warming pass over a population.
 */
export interface PreWarmResult {
  /** Total number of creatures processed. */
  readonly totalCreatures: number;
  /** Number of creatures that need evaluation (no score). */
  readonly unevaluatedCreatures: number;
  /** Number of unique topologies discovered among unevaluated creatures. */
  readonly uniqueTopologies: number;
  /** Number of new WASM templates compiled (cache misses). */
  readonly newTemplatesCompiled: number;
  /** Number of topologies already in cache (cache hits). */
  readonly cachedTemplates: number;
  /** Number of creatures skipped because they are not WASM-eligible. */
  readonly ineligibleCreatures: number;
  /** Wall-clock time for the pre-warming pass in milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Pre-warm the WASM compilation cache for a population of creatures.
 *
 * Issue #2287: Iterates through creatures that need evaluation (no score),
 * pre-computes their topology hashes, and ensures WASM templates are
 * cached for each unique topology.
 *
 * This function is designed to be called after breeding, mutation, and
 * de-duplication — just before the next generation's fitness evaluation.
 *
 * @param creatures - The full population to pre-warm
 * @returns Summary statistics of the pre-warming pass
 */
export function preWarmWasmCache(
  creatures: ReadonlyArray<Creature>,
): PreWarmResult {
  const startMs = Date.now();

  const wasmAvailable = isWasmActivationAvailable();

  // Track unique topologies by hash to avoid redundant compilation
  const seenTopologies = new Set<string>();
  let unevaluatedCount = 0;
  let newTemplates = 0;
  let cachedTemplates = 0;
  let ineligible = 0;

  for (let i = 0, len = creatures.length; i < len; i++) {
    const creature = creatures[i];

    // Only pre-warm creatures that will need fitness evaluation
    if (creature.score !== undefined) continue;
    unevaluatedCount++;

    // Step 1: Pre-compute topology hash (caches on creature.topologyHash)
    const hash = CreatureUtil.getTopologyHash(creature);

    // Skip if we've already processed this topology in this pass
    if (seenTopologies.has(hash)) continue;
    seenTopologies.add(hash);

    // Step 2: Pre-compile WASM template for this topology if eligible
    if (!wasmAvailable) continue;
    if (!isWasmEligible(creature)) {
      ineligible++;
      continue;
    }

    // Check if the template is already cached before calling ensureTemplate
    // to avoid unnecessary topology re-parsing in the cache lookup
    if (hasWasmTemplate(hash)) {
      cachedTemplates++;
    } else {
      const wasCached = ensureWasmTemplate(creature);
      if (wasCached) {
        // Race condition: template was added between hasWasmTemplate and
        // ensureTemplate calls (unlikely but harmless)
        cachedTemplates++;
      } else {
        newTemplates++;
      }
    }
  }

  return {
    totalCreatures: creatures.length,
    unevaluatedCreatures: unevaluatedCount,
    uniqueTopologies: seenTopologies.size,
    newTemplatesCompiled: newTemplates,
    cachedTemplates,
    ineligibleCreatures: ineligible,
    elapsedMs: Date.now() - startMs,
  };
}
