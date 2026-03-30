import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { mergeTagsByNameValue } from "../utils/TagUtils.ts";
import { unifySynapseTypeForMerge } from "../utils/SynapseTypeUnify.ts";

export interface PruneZeroWeightSynapsesResult {
  removedSynapses: number;
}

export interface MergeDuplicateSynapsesResult {
  merged: number;
}

/**
 * Merge duplicate synapses (same from/to) by summing weights and removing
 * duplicates. `type` is unified with {@link unifySynapseTypeForMerge}.
 *
 * Use on **export JSON** when ingesting legacy data outside `loadFrom`, or as
 * an idempotent pre-pass before `Creature.fromJSON`. `loadFrom` also merges
 * duplicate runtime synapses for forward-only creatures (Issue #2086 /
 * GRQ-25). `creatureValidate` and `Creature.fix()` still treat duplicate rows as
 * an error if they reach a live creature without merging.
 *
 * @param creatureExport - The CreatureExport to update (modified in place).
 * @returns Count of duplicates merged (number of removed synapses).
 */
export function mergeDuplicateSynapses(
  creatureExport: CreatureExport,
): MergeDuplicateSynapsesResult {
  normaliseCreatureExport(creatureExport);
  const seen = new Map<string, number>(); // key -> index of first occurrence
  const mergedSynapses: typeof creatureExport.synapses = [];
  let mergedCount = 0;

  for (const synapse of creatureExport.synapses) {
    const key = `${synapse.fromId}->${synapse.toId}`;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, mergedSynapses.length);
      mergedSynapses.push({ ...synapse });
      continue;
    }

    mergedSynapses[existingIndex].weight += synapse.weight;
    mergedCount++;

    mergedSynapses[existingIndex].type = unifySynapseTypeForMerge(
      mergedSynapses[existingIndex].type,
      synapse.type,
    );

    // Best-effort tag merge.
    if (synapse.tags?.length) {
      mergedSynapses[existingIndex].tags = mergeTagsByNameValue(
        mergedSynapses[existingIndex].tags,
        synapse.tags,
      );
    }
  }

  if (mergedCount > 0) {
    creatureExport.synapses = mergedSynapses;
    // Structure changed, so cached memetic references are no longer trustworthy.
    delete creatureExport.memetic;
  }

  return { merged: mergedCount };
}

/**
 * Prunes synapses whose weight is exactly zero.
 *
 * This is behaviour-preserving for forward passes.
 *
 * @param creatureExport - The CreatureExport to prune (modified in place).
 * @returns Count of removed synapses.
 */
export function pruneZeroWeightSynapses(
  creatureExport: CreatureExport,
): PruneZeroWeightSynapsesResult {
  normaliseCreatureExport(creatureExport);
  // IF neurons require at least 3 inward connections with specific typed roles
  // (condition/positive/negative). Even if a weight is zero, dropping a typed
  // synapse can invalidate the structure and break activation semantics.
  const ifNeuronIds = new Set<number>();
  const outputNeuronIds = new Set<number>();
  for (const neuron of creatureExport.neurons) {
    // Note: CreatureExport.neurons does not include input neurons (they are implicit),
    // so `neuron.type` cannot be "input" here.
    if (neuron.squash === "IF") {
      ifNeuronIds.add(neuron.id!);
    }
    if (neuron.type === "output") {
      outputNeuronIds.add(neuron.id!);
    }
  }

  const before = creatureExport.synapses.length;
  const inboundKeptCountsByTo = new Map<number, number>();
  const shouldAlwaysKeep = (s: typeof creatureExport.synapses[number]) => {
    if (s.weight !== 0) return true;

    // Preserve typed synapses (eg IF condition/positive/negative).
    if (s.type) return true;

    // Extra safety: never prune a zero-weight synapse that targets an IF neuron.
    if (ifNeuronIds.has(s.toId!)) return true;

    return false;
  };

  // First pass: count inbound connections that will remain after pruning.
  for (const s of creatureExport.synapses) {
    if (!Number.isFinite(s.weight)) continue;
    if (!shouldAlwaysKeep(s)) continue;
    inboundKeptCountsByTo.set(
      s.toId!,
      (inboundKeptCountsByTo.get(s.toId!) ?? 0) + 1,
    );
  }

  // Second pass: filter, preserving the last inbound connection to outputs for
  // structural validity (mirrors Creature.fix() behaviour).
  const preservedZeroInboundForOutput = new Set<number>();
  creatureExport.synapses = creatureExport.synapses.filter((s) => {
    if (!Number.isFinite(s.weight)) return false;
    if (shouldAlwaysKeep(s)) return true;

    // At this point, the synapse is:
    // - finite
    // - weight === 0
    // - untyped
    // - not targeting an IF neuron
    //
    // Prune it, unless it's the last inbound connection to an output neuron.
    if (outputNeuronIds.has(s.toId!)) {
      const inboundKept = inboundKeptCountsByTo.get(s.toId!) ?? 0;
      if (inboundKept === 0 && !preservedZeroInboundForOutput.has(s.toId!)) {
        preservedZeroInboundForOutput.add(s.toId!);
        return true;
      }
    }

    return false;
  });

  const removed = before - creatureExport.synapses.length;
  if (removed > 0) {
    // Structure changed, so cached memetic references are no longer trustworthy.
    delete creatureExport.memetic;
  }

  return { removedSynapses: removed };
}

/**
 * Merge duplicate synapse rows that share the same runtime neuron indices
 * (`from` / `to`), summing weights and unifying `type` / tags — same semantics
 * as {@link mergeDuplicateSynapses} on export JSON (Issue #2086).
 *
 * Used by `loadFrom` when ingesting corrupt forward-only wire payloads so
 * `fix()`'s duplicate check is not required before validation.
 */
export type SynapseMergeHost = {
  synapses: Synapse[];
  clearCache(): void;
};

export function mergeDuplicateSynapsesInCreature(
  host: SynapseMergeHost,
): number {
  const list = host.synapses;
  if (list.length < 2) return 0;

  const seen = new Map<string, number>();
  const mergedSynapses: Synapse[] = [];
  let mergedCount = 0;

  for (const synapse of list) {
    const key = `${synapse.from}->${synapse.to}`;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, mergedSynapses.length);
      mergedSynapses.push(synapse);
      continue;
    }

    const existing = mergedSynapses[existingIndex];
    existing.weight += synapse.weight;
    existing.type = unifySynapseTypeForMerge(existing.type, synapse.type);
    if (synapse.tags?.length) {
      existing.tags = mergeTagsByNameValue(existing.tags, synapse.tags);
    }
    mergedCount++;
  }

  if (mergedCount > 0) {
    mergedSynapses.sort((a, b) =>
      a.from !== b.from ? a.from - b.from : a.to - b.to
    );
    host.synapses = mergedSynapses;
    host.clearCache();
  }

  return mergedCount;
}
