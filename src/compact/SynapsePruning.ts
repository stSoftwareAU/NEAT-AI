import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { mergeTagsByNameValue } from "../utils/TagUtils.ts";

export interface PruneZeroWeightSynapsesResult {
  removedSynapses: number;
}

export interface MergeDuplicateSynapsesResult {
  merged: number;
}

/**
 * Merge duplicate synapses (same from/to/type) by summing weights and removing
 * duplicates.
 *
 * This is behaviour-preserving for forward passes.
 *
 * Note: we treat `type` as part of synapse identity. A synapse with a `type`
 * (eg IF condition/positive/negative) is not equivalent to an untyped synapse.
 *
 * @param creatureExport - The CreatureExport to update (modified in place).
 * @returns Count of duplicates merged (number of removed synapses).
 */
export function mergeDuplicateSynapses(
  creatureExport: CreatureExport,
): MergeDuplicateSynapsesResult {
  const seen = new Map<string, number>(); // key -> index of first occurrence
  const mergedSynapses: typeof creatureExport.synapses = [];
  let mergedCount = 0;

  for (const synapse of creatureExport.synapses) {
    const typeKey = synapse.type ?? "";
    const key = `${synapse.fromUUID}->${synapse.toUUID}:${typeKey}`;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, mergedSynapses.length);
      mergedSynapses.push({ ...synapse });
      continue;
    }

    mergedSynapses[existingIndex].weight += synapse.weight;
    mergedCount++;

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
  // IF neurons require at least 3 inward connections with specific typed roles
  // (condition/positive/negative). Even if a weight is zero, dropping a typed
  // synapse can invalidate the structure and break activation semantics.
  const ifNeuronUUIDs = new Set<string>();
  const outputNeuronUUIDs = new Set<string>();
  for (const neuron of creatureExport.neurons) {
    // Note: CreatureExport.neurons does not include input neurons (they are implicit),
    // so `neuron.type` cannot be "input" here.
    if (neuron.squash === "IF") {
      ifNeuronUUIDs.add(neuron.uuid);
    }
    if (neuron.type === "output") {
      outputNeuronUUIDs.add(neuron.uuid);
    }
  }

  const before = creatureExport.synapses.length;
  const inboundKeptCountsByTo = new Map<string, number>();
  const shouldAlwaysKeep = (s: typeof creatureExport.synapses[number]) => {
    if (s.weight !== 0) return true;

    // Preserve typed synapses (eg IF condition/positive/negative).
    if (s.type) return true;

    // Extra safety: never prune a zero-weight synapse that targets an IF neuron.
    if (ifNeuronUUIDs.has(s.toUUID)) return true;

    return false;
  };

  // First pass: count inbound connections that will remain after pruning.
  for (const s of creatureExport.synapses) {
    if (!Number.isFinite(s.weight)) continue;
    if (!shouldAlwaysKeep(s)) continue;
    inboundKeptCountsByTo.set(
      s.toUUID,
      (inboundKeptCountsByTo.get(s.toUUID) ?? 0) + 1,
    );
  }

  // Second pass: filter, preserving the last inbound connection to outputs for
  // structural validity (mirrors Creature.fix() behaviour).
  const preservedZeroInboundForOutput = new Set<string>();
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
    if (outputNeuronUUIDs.has(s.toUUID)) {
      const inboundKept = inboundKeptCountsByTo.get(s.toUUID) ?? 0;
      if (inboundKept === 0 && !preservedZeroInboundForOutput.has(s.toUUID)) {
        preservedZeroInboundForOutput.add(s.toUUID);
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
