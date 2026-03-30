import type {
  MemeticAncestorSnapshot,
  MemeticInterface,
} from "@blackbox/MemeticInterface.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Deletes memetic data if the removed synapse is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param fromId - The source neuron UUID of the removed synapse.
 * @param toId - The target neuron UUID of the removed synapse.
 */
export function cleanupMemeticForRemovedSynapse(
  creatureExport: CreatureExport,
  fromId: number,
  toId: number,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic?.weights) return;

  const weights = memetic.weights[fromId];
  if (weights?.some((w) => w.toId === toId)) {
    delete creatureExport.memetic;
  }
}

/**
 * Deletes memetic data if the removed neuron is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param neuronId - The UUID of the neuron that was removed.
 */
export function cleanupMemeticForRemovedNeuron(
  creatureExport: CreatureExport,
  neuronId: number,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic) return;

  // Check if neuron is in weights (as source or target) or biases
  if (memetic.weights) {
    if (memetic.weights[neuronId]) {
      delete creatureExport.memetic;
      return;
    }
    for (const weights of Object.values(memetic.weights)) {
      if (weights?.some((w: { toId: number }) => w.toId === neuronId)) {
        delete creatureExport.memetic;
        return;
      }
    }
  }

  if (memetic.biases?.[neuronId] !== undefined) {
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
