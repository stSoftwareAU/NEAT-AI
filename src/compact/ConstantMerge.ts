import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { allocateStructuralNeuronIdForCreature } from "@architecture/NeuronId.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { normaliseComputationalNeuronOrderInExport } from "@architecture/NormaliseComputationalNeuronOrder.ts";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";

/**
 * Well-known UUIDs for the canonical bias-1 constants (Issue #3808).
 *
 * These are fixed fleet-wide — exactly like the `input-N` / `output-N`
 * convention — so a constant merged on one machine aligns with the same
 * constant merged on another when the two creatures are bred.
 *
 * Three slots, not one: a single consumer may take a different constant on each
 * of an IF neuron's synapse roles (`condition`, `positive`, `negative`), and a
 * (from, to) pair may hold only one synapse — so three distinct source neurons
 * are needed to feed one IF entirely from constants.
 */
export const CANONICAL_CONSTANT_UUIDS: readonly string[] = [
  "constant-0",
  "constant-1",
  "constant-2",
];

/** Every canonical constant emits exactly 1; the value moves onto the weight. */
export const CANONICAL_CONSTANT_BIAS = 1;

/**
 * Result of merging redundant constant neurons.
 */
export interface ConstantMergeResult {
  /** Whether any constant was re-pointed at a canonical constant. */
  changed: boolean;
  /** Number of constant neurons removed (merged away). */
  removedNeurons: number;
  /** Net number of synapses removed (grouped inputs collapse to one). */
  removedSynapses: number;
}

/** A set of inbound synapses on one consumer that can share one canonical constant. */
interface MergeGroup {
  /** Role carried by the rewired synapse (`undefined` = plain additive edge). */
  type?: "positive" | "negative" | "condition";
  synapses: SynapseExport[];
}

/**
 * Merge redundant constant neurons into at most three canonical bias-1
 * constants (Issue #3808).
 *
 * IF-squash tree generation accumulates one `type:"constant"` producer per
 * generated branch, each with its own bias. {@link foldConstants} cannot absorb
 * them because an aggregate consumer (IF/MAXIMUM/MINIMUM/HYPOT) reads each
 * inbound value individually rather than summing it into a bias — so the
 * constants pile up unbounded (277 of them in the worst GRQ-sampler creature).
 *
 * A constant contributes exactly `bias · weight` to its consumer (see
 * `makeSynapsesValue`), so the bias can be moved onto the outgoing weight:
 *
 * ```text
 *   bias b × weight w   →   canonical bias 1 × weight (w · b)
 * ```
 *
 * The rewrite is therefore exact — the creature's error is unchanged — while
 * the score improves as the redundant neurons are removed.
 *
 * Grouping rules (why one consumer may need more than one canonical constant):
 * - `creatureValidate` rejects duplicate (from, to) synapses, so two inbound
 *   synapses on the same consumer can only share a canonical constant when they
 *   can be **summed** into a single synapse.
 * - **IF consumers**: values are summed per role (`condition`, `positive`,
 *   `negative` — see `IF.inlineActivation`), so each role becomes one group and
 *   one IF needs at most three canonical constants.
 * - **Other aggregate consumers** (MAXIMUM/MINIMUM/HYPOT) treat every inbound
 *   value separately, so each synapse is its own group.
 * - **Additive consumers** sum their inputs, so synapses sharing a role are one
 *   group.
 *
 * When a consumer needs more groups than there are free canonical slots, the
 * surplus groups keep their original constants — a partial merge is still
 * exact, because a retained constant keeps both its bias and its weight.
 *
 * Safety rules:
 * - Frozen constants, frozen consumers and frozen synapses are never touched
 *   (Issue #1861 convention).
 * - Merged-away constants are deleted only once they have no outbound synapses
 *   left; every surviving neuron keeps its UUID (AGENTS.md neuron-UUID
 *   invariant).
 * - Re-running the pass is a no-op: canonical constants are never candidates.
 *
 * The export is modified in place.
 *
 * @param creatureExport - The CreatureExport to merge (modified in place).
 * @returns Counts of removed neurons/synapses and whether anything changed.
 */
export function mergeRedundantConstants(
  creatureExport: CreatureExport,
): ConstantMergeResult {
  normaliseCreatureExport(creatureExport);

  const neuronById = new Map<number, NeuronExport>();
  for (const neuron of creatureExport.neurons) {
    neuronById.set(neuron.id!, neuron);
  }

  const candidates = collectCandidates(creatureExport.neurons);
  if (candidates.size === 0) {
    return { changed: false, removedNeurons: 0, removedSynapses: 0 };
  }

  const canonicalBySlot = collectCanonicalConstants(creatureExport.neurons);

  const inboundByConsumer = new Map<number, SynapseExport[]>();
  for (const synapse of creatureExport.synapses) {
    const list = inboundByConsumer.get(synapse.toId!);
    if (list) list.push(synapse);
    else inboundByConsumer.set(synapse.toId!, [synapse]);
  }

  const retired = new Set<SynapseExport>();
  const added: SynapseExport[] = [];

  for (const [consumerId, inbound] of inboundByConsumer) {
    const consumer = neuronById.get(consumerId);
    if (!consumer || consumer.frozen) continue;

    const usedSlots = occupiedSlots(inbound, neuronById);

    for (const group of buildMergeGroups(inbound, candidates, consumer)) {
      const slot = firstFreeSlot(usedSlots);
      if (slot === undefined) break; // No canonical slot left on this consumer.

      const weight = combinedWeight(group, candidates);
      if (weight === undefined) continue; // Non-finite product — leave as is.

      usedSlots.add(slot);
      const canonical = ensureCanonicalConstant(
        creatureExport,
        canonicalBySlot,
        slot,
      );

      const rewired: SynapseExport = {
        fromId: canonical.id!,
        fromUUID: canonical.uuid,
        toId: consumerId,
        weight,
      };
      const toUUID = group.synapses[0].toUUID;
      if (toUUID !== undefined) rewired.toUUID = toUUID;
      if (group.type !== undefined) rewired.type = group.type;
      const tags = group.synapses.reduce<SynapseExport["tags"]>(
        (acc, synapse) => mergeTagsByNameValue(acc, synapse.tags),
        undefined,
      );
      if (tags) rewired.tags = tags;

      added.push(rewired);
      for (const synapse of group.synapses) {
        retired.add(synapse);
      }
    }
  }

  if (added.length === 0) {
    return { changed: false, removedNeurons: 0, removedSynapses: 0 };
  }

  const synapsesBefore = creatureExport.synapses.length;
  creatureExport.synapses = creatureExport.synapses
    .filter((synapse) => !retired.has(synapse))
    .concat(added);

  const removedNeurons = dropDisconnectedCandidates(creatureExport, candidates);

  normaliseComputationalNeuronOrderInExport(creatureExport);
  delete creatureExport.memetic;
  normaliseCreatureExport(creatureExport);

  return {
    changed: true,
    removedNeurons,
    removedSynapses: synapsesBefore - creatureExport.synapses.length,
  };
}

/**
 * Constants eligible to be merged away: every non-frozen `type:"constant"`
 * neuron with a finite bias that is not already a canonical constant. Mapped by
 * runtime id to its bias.
 */
function collectCandidates(neurons: NeuronExport[]): Map<number, number> {
  const canonical = new Set(CANONICAL_CONSTANT_UUIDS);
  const candidates = new Map<number, number>();
  for (const neuron of neurons) {
    if (neuron.type !== "constant") continue;
    if (neuron.frozen) continue;
    if (neuron.uuid !== undefined && canonical.has(neuron.uuid)) continue;
    if (!Number.isFinite(neuron.bias)) continue;
    candidates.set(neuron.id!, neuron.bias);
  }
  return candidates;
}

/** Canonical constants already present in the export, keyed by slot. */
function collectCanonicalConstants(
  neurons: NeuronExport[],
): Map<number, NeuronExport> {
  const bySlot = new Map<number, NeuronExport>();
  for (const neuron of neurons) {
    if (neuron.type !== "constant" || neuron.uuid === undefined) continue;
    const slot = CANONICAL_CONSTANT_UUIDS.indexOf(neuron.uuid);
    if (slot >= 0) bySlot.set(slot, neuron);
  }
  return bySlot;
}

/**
 * Canonical slots already feeding this consumer. A second synapse from the same
 * canonical constant would be a duplicate (from, to) pair, which
 * `creatureValidate` rejects.
 */
function occupiedSlots(
  inbound: SynapseExport[],
  neuronById: Map<number, NeuronExport>,
): Set<number> {
  const used = new Set<number>();
  for (const synapse of inbound) {
    const from = neuronById.get(synapse.fromId!);
    if (from?.uuid === undefined) continue;
    const slot = CANONICAL_CONSTANT_UUIDS.indexOf(from.uuid);
    if (slot >= 0) used.add(slot);
  }
  return used;
}

function firstFreeSlot(used: Set<number>): number | undefined {
  for (let slot = 0; slot < CANONICAL_CONSTANT_UUIDS.length; slot++) {
    if (!used.has(slot)) return slot;
  }
  return undefined;
}

/**
 * Partition a consumer's constant-sourced inbound synapses into groups that can
 * each collapse to one synapse from one canonical constant. Insertion order is
 * the synapse order, so the assignment is deterministic.
 */
function buildMergeGroups(
  inbound: SynapseExport[],
  candidates: Map<number, number>,
  consumer: NeuronExport,
): MergeGroup[] {
  const isIf = consumer.squash === "IF";
  // MAXIMUM/MINIMUM/HYPOT read each inbound value separately — never summable.
  const perSynapse = !isIf && isAggregationSquash(consumer.squash);

  const groups = new Map<string, MergeGroup>();
  let index = 0;
  for (const synapse of inbound) {
    index++;
    if (synapse.frozen) continue;
    if (!candidates.has(synapse.fromId!)) continue;

    // An IF reads an untyped inbound synapse as its positive branch, so the
    // rewired edge carries the role explicitly.
    const type = isIf ? (synapse.type ?? "positive") : synapse.type;
    const key = perSynapse ? `#${index}` : `${type ?? ""}`;

    const group = groups.get(key);
    if (group) group.synapses.push(synapse);
    else groups.set(key, { type, synapses: [synapse] });
  }

  return [...groups.values()];
}

/**
 * Combined weight of a group: `Σ(weightᵢ · biasᵢ)`, the exact contribution the
 * canonical bias-1 constant must reproduce. `undefined` when the arithmetic is
 * not finite, so the caller leaves the group alone rather than corrupting it.
 */
function combinedWeight(
  group: MergeGroup,
  candidates: Map<number, number>,
): number | undefined {
  let weight = 0;
  for (const synapse of group.synapses) {
    weight += synapse.weight * candidates.get(synapse.fromId!)!;
  }
  return Number.isFinite(weight) ? weight : undefined;
}

/**
 * Fetch the canonical constant for a slot, creating it when absent. New
 * canonical constants are inserted at the head of the export so the
 * constants-before-hiddens neuron order stays valid.
 */
function ensureCanonicalConstant(
  creatureExport: CreatureExport,
  canonicalBySlot: Map<number, NeuronExport>,
  slot: number,
): NeuronExport {
  const existing = canonicalBySlot.get(slot);
  if (existing) return existing;

  const created: NeuronExport = {
    type: "constant",
    uuid: CANONICAL_CONSTANT_UUIDS[slot],
    bias: CANONICAL_CONSTANT_BIAS,
    id: allocateStructuralNeuronIdForCreature({
      neurons: creatureExport.neurons.map((neuron) => ({ id: neuron.id! })),
    }),
  };
  creatureExport.neurons.unshift(created);
  canonicalBySlot.set(slot, created);
  return created;
}

/**
 * Delete merged-away constants that no longer feed anything, along with any
 * synapse still pointing at them. Constants that kept an outbound synapse (a
 * consumer with no free canonical slot) survive untouched, bias included.
 */
function dropDisconnectedCandidates(
  creatureExport: CreatureExport,
  candidates: Map<number, number>,
): number {
  const stillFeeding = new Set<number>();
  for (const synapse of creatureExport.synapses) {
    stillFeeding.add(synapse.fromId!);
  }

  const doomed = new Set<number>();
  for (const id of candidates.keys()) {
    if (!stillFeeding.has(id)) doomed.add(id);
  }
  if (doomed.size === 0) return 0;

  creatureExport.neurons = creatureExport.neurons.filter(
    (neuron) => !doomed.has(neuron.id!),
  );
  creatureExport.synapses = creatureExport.synapses.filter(
    (synapse) => !doomed.has(synapse.toId!),
  );
  return doomed.size;
}
