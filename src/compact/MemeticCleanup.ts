import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";

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
