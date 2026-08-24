/**
 * @module
 *
 * Synapse-level clean-up that leaves a forward pass unchanged: dropping
 * exactly-zero-weight synapses, and merging duplicate synapses that share the
 * same endpoints by summing their weights and unifying their `type` and tags.
 *
 * Duplicate rows arise from legacy wire payloads and from structural edits that
 * re-add an existing edge; left alone they are rejected by `creatureValidate`
 * and `Creature.fix()`. Reach for these helpers as an idempotent pre-pass
 * before `Creature.fromJSON`, or when ingesting export JSON outside `loadFrom`
 * (which already merges duplicates for forward-only creatures — Issue #2086).
 *
 * Each operation comes in two forms: one over a {@link CreatureExport} for wire
 * payloads, and one over a live creature's runtime synapse arrays.
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { Synapse } from "@architecture/Synapse.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import {
  compareSynapses,
  isRoleReadingTarget,
  synapseRoleRank,
} from "@architecture/SynapseKey.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";
import { unifySynapseTypeForMerge } from "@utils/SynapseTypeUnify.ts";

export interface PruneZeroWeightSynapsesResult {
  removedSynapses: number;
}

export interface MergeDuplicateSynapsesResult {
  merged: number;
}

/**
 * Merge duplicate synapses by summing weights and removing duplicates. `type`
 * is unified with {@link unifySynapseTypeForMerge}.
 *
 * Issue #3873: what counts as a duplicate depends on the target. Every squash
 * but `IF` sums its inward synapses regardless of role, so a repeated
 * `(from, to)` there is one synapse with the summed weight. An `IF` neuron
 * keeps a separate sum per role, so its duplicates are only exact
 * `(from, to, type)` repeats — merging a `positive` into a `negative` would
 * change what the creature computes.
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
  const roleReadingTargets = new Set<number>();
  for (const neuron of creatureExport.neurons) {
    if (neuron.squash === "IF") roleReadingTargets.add(neuron.id!);
  }

  const seen = new Map<string, number>(); // key -> index of first occurrence
  const mergedSynapses: typeof creatureExport.synapses = [];
  let mergedCount = 0;

  for (const synapse of creatureExport.synapses) {
    const key = roleReadingTargets.has(synapse.toId!)
      ? `${synapse.fromId}->${synapse.toId}/${synapseRoleRank(synapse.type)}`
      : `${synapse.fromId}->${synapse.toId}`;
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
 * Merge duplicate synapse rows that share the same runtime key, summing weights
 * and unifying `type` / tags — same semantics as
 * {@link mergeDuplicateSynapses} on export JSON (Issue #2086).
 *
 * Issue #3873: the key is `(from, to)` for every target but an `IF` neuron,
 * whose per-role sums make two roles from one source two distinct synapses.
 *
 * Used by `loadFrom` when ingesting corrupt forward-only wire payloads so
 * `fix()`'s duplicate check is not required before validation.
 */
export type SynapseMergeHost = {
  synapses: Synapse[];
  neurons: ReadonlyArray<{ squash?: string }>;
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
    const key = isRoleReadingTarget(host.neurons, synapse.to)
      ? `${synapse.from}->${synapse.to}/${synapseRoleRank(synapse.type)}`
      : `${synapse.from}->${synapse.to}`;
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
    mergedSynapses.sort(compareSynapses);
    host.synapses = mergedSynapses;
    host.clearCache();
  }

  return mergedCount;
}
