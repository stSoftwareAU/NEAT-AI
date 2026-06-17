import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

/**
 * Default structural threshold below which a synapse weight is judged
 * "low-impact" (Issue #3038). Purely structural and dataset-free — no error is
 * ever measured on data here. The exact value is an implementation detail: the
 * resulting candidate is score-gated by population selection, so the threshold
 * is free to be tuned later without changing the contract.
 */
export const AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD = 1e-3;

/** Result of an aggressive structural prune pass. */
export interface AggressivePruneResult {
  /** Whether any synapse was pruned. */
  changed: boolean;
  /** Number of synapses removed. */
  removedSynapses: number;
}

/**
 * Aggressive, dataset-free structural prune (Issue #3038).
 *
 * Speculatively drops the low-impact synapses the **safe** compaction pass
 * deliberately leaves untouched: small-magnitude untyped weights, *including*
 * those feeding aggregate consumers (`MAXIMUM`/`MINIMUM`/`HYPOT`/`HYPOTv2`) and
 * non-constant neurons — exactly the cases the exact/safe variant must not fold.
 *
 * "Low-impact" is judged **structurally only** (`|weight| < threshold`). No
 * training data is threaded in and no error is measured: the pass is a gamble
 * whose result is returned as a *candidate*. Population scoring keeps it only if
 * it beats the safe floor, so an over-eager prune costs nothing.
 *
 * Safety rules (mirroring the safe pass so the candidate stays loadable):
 * - Frozen synapses (Issue #1861) are never pruned.
 * - Typed synapses (eg IF `condition`/`positive`/`negative` roles) are never
 *   pruned — dropping one would break the aggregate's activation contract.
 * - Synapses targeting an `IF` neuron are never pruned, even when untyped.
 * - Every output neuron keeps at least one inbound synapse for structural
 *   validity. Hidden neurons stranded by pruning are left to the dedicated
 *   orphan / dead-subgraph cleanup that runs after this pass.
 *
 * The export is modified in place.
 *
 * @param creatureExport - The CreatureExport to prune (modified in place).
 * @param weightThreshold - Magnitude below which a weight is low-impact.
 * @returns Count of removed synapses and whether anything changed.
 */
export function aggressivePrune(
  creatureExport: CreatureExport,
  weightThreshold: number = AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD,
): AggressivePruneResult {
  normaliseCreatureExport(creatureExport);

  const ifNeuronIds = new Set<number>();
  const outputNeuronIds = new Set<number>();
  for (const neuron of creatureExport.neurons as NeuronExport[]) {
    // CreatureExport.neurons excludes input neurons (they are implicit).
    if (neuron.squash === "IF") ifNeuronIds.add(neuron.id!);
    if (neuron.type === "output") outputNeuronIds.add(neuron.id!);
  }

  // A synapse is structurally pinned (never a prune candidate) when it is
  // frozen, typed, or targets an IF neuron.
  const isPinned = (s: SynapseExport): boolean =>
    s.frozen === true || s.type !== undefined || ifNeuronIds.has(s.toId!);

  // Count the inbound edges each output will retain so its last one is kept.
  const outputInboundKept = new Map<number, number>();
  for (const s of creatureExport.synapses) {
    if (!outputNeuronIds.has(s.toId!)) continue;
    if (isPinned(s) || Math.abs(s.weight) >= weightThreshold) {
      outputInboundKept.set(s.toId!, (outputInboundKept.get(s.toId!) ?? 0) + 1);
    }
  }

  const pruneSet = new Set<SynapseExport>();
  for (const s of creatureExport.synapses) {
    if (isPinned(s)) continue;
    if (!Number.isFinite(s.weight)) continue;
    if (Math.abs(s.weight) >= weightThreshold) continue;

    // Keep the last inbound edge of an output for structural validity.
    if (outputNeuronIds.has(s.toId!)) {
      const kept = outputInboundKept.get(s.toId!) ?? 0;
      if (kept === 0) {
        outputInboundKept.set(s.toId!, 1);
        continue;
      }
    }

    pruneSet.add(s);
  }

  if (pruneSet.size === 0) return { changed: false, removedSynapses: 0 };

  const before = creatureExport.synapses.length;
  creatureExport.synapses = creatureExport.synapses.filter(
    (s) => !pruneSet.has(s),
  );
  const removedSynapses = before - creatureExport.synapses.length;

  // Structure changed, so cached memetic references are no longer trustworthy.
  delete creatureExport.memetic;

  return { changed: removedSynapses > 0, removedSynapses };
}
