/**
 * Supplement From Cache Module
 *
 * When Phase 1 produces only 1 successful single candidate, supplements
 * with historically successful candidates from the success cache to enable
 * Phase 2 combination building.
 *
 * Part of #1734: Lower Phase 2 combination threshold from 2 to 1.
 */

import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type { Creature } from "../Creature.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  buildWireToRuntimeIdMap,
  resolveWireToRuntimeId,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { buildCacheKey } from "./FailureCacheKey.ts";
import type {
  DiscoveryCandidate,
  DiscoveryCandidateChange,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";
import {
  applyEntryUsingRustRequest,
  isAlreadyApplied,
} from "./ReplayEntryApplication.ts";
import {
  listSuccessEntriesSync,
  type SuccessCacheEntry,
} from "./SuccessCache.ts";

/** Maximum number of cache entries to supplement with by default. */
const DEFAULT_MAX_SUPPLEMENTS = 5;

/**
 * Checks whether a success cache entry references neurons/synapses
 * that still exist in the current creature.
 *
 * This pre-filter avoids calling the more expensive
 * `applyEntryUsingRustRequest` on entries that clearly cannot apply.
 */
function isEntryRelevantToCreature(
  creature: Creature,
  entry: SuccessCacheEntry,
): boolean {
  const req = entry.rustRequest;
  if (!req) return false;
  const neuronIds = new Set(creature.neurons.map((n) => n.id));
  const wireToId = buildWireToRuntimeIdMap(creature);

  switch (entry.changeType) {
    case "add-synapses": {
      const c = req.synapseCandidate as
        | { fromNeuronUuid?: string; toNeuronUuid?: string }
        | undefined;
      if (!c?.fromNeuronUuid || !c?.toNeuronUuid) return false;
      const fromId = resolveWireToRuntimeId(wireToId, c.fromNeuronUuid);
      const toId = resolveWireToRuntimeId(wireToId, c.toNeuronUuid);
      return fromId !== undefined && toId !== undefined &&
        neuronIds.has(fromId) && neuronIds.has(toId);
    }
    case "add-neurons": {
      const c = req.neuronCandidate as
        | { fromNeuronUuid?: string; toNeuronUuid?: string }
        | undefined;
      if (!c?.fromNeuronUuid || !c?.toNeuronUuid) return false;
      const fromId = resolveWireToRuntimeId(wireToId, c.fromNeuronUuid);
      const toId = resolveWireToRuntimeId(wireToId, c.toNeuronUuid);
      return fromId !== undefined && toId !== undefined &&
        neuronIds.has(fromId) && neuronIds.has(toId);
    }
    case "change-squash": {
      const c = req.squashCandidate as { neuronUuid?: string } | undefined;
      if (!c?.neuronUuid) return false;
      const neuronId = resolveWireToRuntimeId(wireToId, c.neuronUuid);
      return neuronId !== undefined && neuronIds.has(neuronId);
    }
    case "remove-low-impact": {
      const c = req.removalCandidate as { neuronUuid?: string } | undefined;
      if (!c?.neuronUuid) return false;
      const neuronId = resolveWireToRuntimeId(wireToId, c.neuronUuid);
      return neuronId !== undefined && neuronIds.has(neuronId);
    }
    case "remove-neuron": {
      const c = req.harmfulNeuronCandidate as
        | { neuronUuid?: string }
        | undefined;
      if (!c?.neuronUuid) return false;
      const neuronId = resolveWireToRuntimeId(wireToId, c.neuronUuid);
      return neuronId !== undefined && neuronIds.has(neuronId);
    }
    case "remove-synapse": {
      const c = (req.harmfulSynapseCandidate ?? req.synapseCandidate ??
        req.synapseDetails) as
          | { fromNeuronUuid?: string; toNeuronUuid?: string }
          | undefined;
      if (!c?.fromNeuronUuid || !c?.toNeuronUuid) return false;
      const fromId = resolveWireToRuntimeId(wireToId, c.fromNeuronUuid);
      const toId = resolveWireToRuntimeId(wireToId, c.toNeuronUuid);
      return fromId !== undefined && toId !== undefined &&
        neuronIds.has(fromId) && neuronIds.has(toId);
    }
    default:
      return false;
  }
}

/**
 * Reconstructs a DiscoveryCandidate from a success cache entry
 * and the creature that results from applying it.
 */
function buildCandidateFromEntry(
  creature: Creature,
  entry: SuccessCacheEntry,
): DiscoveryCandidate | undefined {
  const req = entry.rustRequest;
  if (!req) return undefined;

  const changeType = entry.changeType as DiscoveryChangeType;

  const change: DiscoveryCandidateChange = {
    type: changeType,
    description: entry.description,
  };

  // Populate the appropriate candidate field from the stored rustRequest.
  if (req.neuronCandidate) {
    change.neuronCandidate = req.neuronCandidate as CandidateNeuron;
  }
  if (req.synapseCandidate) {
    change.synapseCandidate = req.synapseCandidate as CandidateSynapse;
  }
  if (req.squashCandidate) {
    change.squashCandidate = req.squashCandidate as CandidateSquash;
  }
  if (req.removalCandidate) {
    change.removalCandidate = req.removalCandidate as RemovalCandidate;
  }
  if (req.harmfulNeuronCandidate) {
    change.harmfulNeuronCandidate = req
      .harmfulNeuronCandidate as CandidateHarmfulNeuron;
  }
  if (req.harmfulSynapseCandidate) {
    change.harmfulSynapseCandidate = req
      .harmfulSynapseCandidate as CandidateSynapse;
  }
  if (req.synapseDetails) {
    change.synapseDetails = req.synapseDetails as {
      fromNeuronUuid: string;
      toNeuronUuid: string;
    };
  }
  if (req.coordinatedStructuralCandidate) {
    change.coordinatedStructuralCandidate = req
      .coordinatedStructuralCandidate as CoordinatedStructuralCandidate;
  }

  return { creature, change };
}

/**
 * Supplements Phase 2 combination building with historically successful
 * candidates from the success cache.
 *
 * Used when Phase 1 produces only 1 successful single candidate, to enable
 * combination building that normally requires 2+ successful candidates.
 *
 * Candidates are validated against the current creature to ensure referenced
 * neurons and synapses still exist, and already-applied changes are skipped.
 *
 * @param baseCreature The current creature to validate candidates against
 * @param successCacheDir Success cache directory path
 * @param existingSuccessful Candidates already successful from Phase 1
 * @param maxSupplements Maximum number of supplemental candidates (default 5)
 * @returns Supplemental DiscoveryCandidate objects from the cache
 */
export function supplementFromCache(
  baseCreature: Creature,
  successCacheDir: string | undefined,
  existingSuccessful: DiscoveryCandidate[],
  maxSupplements?: number,
): DiscoveryCandidate[] {
  if (!successCacheDir) return [];

  let entries: SuccessCacheEntry[];
  try {
    entries = listSuccessEntriesSync(successCacheDir);
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  // Filter out combo entries and coordinated-structural (already multi-op).
  const singleEntries = entries.filter(
    (e) =>
      !e.changeType.startsWith("combo-") &&
      e.changeType !== "coordinated-structural",
  );

  // Sort by scoreDelta descending (best historical performers first).
  singleEntries.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0));

  // Build cache keys for existing Phase 1 successes to avoid duplicates.
  const existingKeys = new Set<string>();
  for (const c of existingSuccessful) {
    try {
      existingKeys.add(buildCacheKey(c));
    } catch {
      // Ignore key build failures for edge-case candidates.
    }
  }

  const supplements: DiscoveryCandidate[] = [];
  const limit = maxSupplements ?? DEFAULT_MAX_SUPPLEMENTS;

  for (const entry of singleEntries) {
    if (supplements.length >= limit) break;

    // Skip if this entry would duplicate an existing Phase 1 success.
    if (entry.key && existingKeys.has(entry.key)) continue;

    // Skip entries that have already been applied to the creature.
    if (isAlreadyApplied(baseCreature, entry)) continue;

    // Validate that referenced neurons/synapses still exist.
    if (!isEntryRelevantToCreature(baseCreature, entry)) continue;

    // Apply the entry to get the modified creature.
    const modified = applyEntryUsingRustRequest(baseCreature, entry);
    if (!modified) continue;

    // Reconstruct the DiscoveryCandidate.
    const candidate = buildCandidateFromEntry(modified, entry);
    if (candidate) {
      supplements.push(candidate);
    }
  }

  if (supplements.length > 0) {
    getLogger().info(
      `[SupplementFromCache] Loaded ${supplements.length} historical success${
        supplements.length === 1 ? "" : "es"
      } from cache for combination building`,
    );
  }

  return supplements;
}
