import type {
  MemeticAncestorSnapshot,
  MemeticInterface,
} from "@blackbox/MemeticInterface.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Resolves a runtime neuron id to a wire label using `CreatureExport` metadata.
 * Returns undefined when `id` fields are absent on neurons (pure wire JSON).
 */
function runtimeNeuronIdToWireLabel(
  exp: CreatureExport,
  id: number,
): string | undefined {
  const inCount = exp.input ?? 0;
  for (let i = 0; i < inCount; i++) {
    if (i === id) return `input-${i}`;
  }
  for (const n of exp.neurons) {
    const nid = (n as { id?: number }).id;
    if (nid === id && typeof n.uuid === "string") {
      return n.uuid;
    }
  }
  return undefined;
}

/**
 * Deletes memetic data if the removed synapse is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param fromId - Runtime source neuron id (legacy map) or resolvable via export ids for wire-array memetic.
 * @param toId - Runtime target neuron id.
 */
export function cleanupMemeticForRemovedSynapse(
  creatureExport: CreatureExport,
  fromId: number,
  toId: number,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic?.weights) return;

  // deno-lint-ignore no-explicit-any
  const w = memetic.weights as any;
  if (Array.isArray(w)) {
    const fromLabel = runtimeNeuronIdToWireLabel(creatureExport, fromId);
    const toLabel = runtimeNeuronIdToWireLabel(creatureExport, toId);
    if (
      fromLabel &&
      toLabel &&
      w.some(
        (row: { fromUUID: string; toUUID: string }) =>
          row.fromUUID === fromLabel && row.toUUID === toLabel,
      )
    ) {
      delete creatureExport.memetic;
    }
    return;
  }

  const weights = w[fromId];
  if (weights?.some((entry: { toId: number }) => entry.toId === toId)) {
    delete creatureExport.memetic;
  }
}

/**
 * Deletes memetic data if the removed neuron is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param neuronRef - Runtime id for legacy memetic maps, or wire `uuid` / `input-N` when memetic uses array weights or string bias keys (e.g. after `exportJSON()`).
 */
export function cleanupMemeticForRemovedNeuron(
  creatureExport: CreatureExport,
  neuronRef: number | string,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic) return;

  const wireLabel = typeof neuronRef === "string"
    ? neuronRef
    : runtimeNeuronIdToWireLabel(creatureExport, neuronRef);

  // deno-lint-ignore no-explicit-any
  const weightsAny = memetic.weights as any;
  if (Array.isArray(weightsAny)) {
    if (
      wireLabel &&
      weightsAny.some(
        (row: { fromUUID?: string; toUUID?: string }) =>
          row.fromUUID === wireLabel || row.toUUID === wireLabel,
      )
    ) {
      delete creatureExport.memetic;
      return;
    }
  } else if (memetic.weights && typeof neuronRef === "number") {
    if (weightsAny[neuronRef]) {
      delete creatureExport.memetic;
      return;
    }
    for (const entries of Object.values(weightsAny)) {
      if (
        Array.isArray(entries) &&
        entries.some((entry: { toId: number }) => entry.toId === neuronRef)
      ) {
        delete creatureExport.memetic;
        return;
      }
    }
  }

  const biases = memetic.biases as Record<string, number> | undefined;
  if (wireLabel !== undefined && biases?.[wireLabel] !== undefined) {
    delete creatureExport.memetic;
    return;
  }
  if (typeof neuronRef === "number" && biases?.[neuronRef] !== undefined) {
    delete creatureExport.memetic;
  }
}

type MemeticBiasWeights = {
  biases?: Record<number, number>;
  weights?: Record<number, { toId: number; weight: number }[]>;
};

/** Minimal creature shape for memetic pruning (avoids importing {@link Creature}). */
export type MemeticPruneTarget = {
  memetic?: MemeticInterface;
  neurons: { id: number }[];
  synapses: { from: number; to: number }[];
};

/**
 * Drops memetic biases/weights that reference neurons or synapses no longer
 * present on the live creature.
 *
 * Structural repair (`fix()`, orphan cleanup, some mutations) can remove
 * neurons or synapses while leaving copied memetic snapshots intact; strict
 * validation then fails with MEMETIC. This pass keeps valid entries only.
 */
export function pruneOrphanMemeticReferences(
  creature: MemeticPruneTarget,
): void {
  const memetic = creature.memetic;
  if (!memetic) return;

  const validIds = new Set<number>();
  for (const n of creature.neurons) {
    validIds.add(n.id);
  }

  const synapseKeys = new Set<string>();
  for (const s of creature.synapses) {
    const fromN = creature.neurons[s.from];
    const toN = creature.neurons[s.to];
    if (fromN?.id !== undefined && toN?.id !== undefined) {
      synapseKeys.add(`${fromN.id}->${toN.id}`);
    }
  }

  const pruneSubtree = (node: MemeticBiasWeights): void => {
    const biases = node.biases as Record<string, number> | undefined;
    if (biases) {
      for (const k of Object.keys(biases)) {
        const id = Number(k);
        if (!validIds.has(id)) {
          delete biases[k];
        }
      }
    }

    const weights = node.weights as
      | Record<string, { toId: number; weight: number }[]>
      | undefined;
    if (!weights) return;

    for (const k of Object.keys(weights)) {
      const fromId = Number(k);
      if (!validIds.has(fromId)) {
        delete weights[k];
        continue;
      }
      const arr = weights[k];
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter(
        (w) =>
          validIds.has(w.toId) &&
          synapseKeys.has(`${fromId}->${w.toId}`),
      );
      if (filtered.length === 0) {
        delete weights[k];
      } else if (filtered.length !== arr.length) {
        weights[k] = filtered;
      }
    }
  };

  pruneSubtree(memetic);

  if (Array.isArray(memetic.ancestry)) {
    for (const snap of memetic.ancestry as MemeticAncestorSnapshot[]) {
      pruneSubtree(snap);
    }
  }
}
