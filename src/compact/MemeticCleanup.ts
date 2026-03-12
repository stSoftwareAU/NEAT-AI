import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";

/**
 * Deletes memetic data if the removed synapse is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param fromUUID - The source neuron UUID of the removed synapse.
 * @param toUUID - The target neuron UUID of the removed synapse.
 */
export function cleanupMemeticForRemovedSynapse(
  creatureExport: CreatureExport,
  fromUUID: string,
  toUUID: string,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic?.weights) return;

  const weights = memetic.weights[fromUUID];
  if (weights?.some((w) => w.toUUID === toUUID)) {
    delete creatureExport.memetic;
  }
}

/**
 * Deletes memetic data if the removed neuron is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param neuronUUID - The UUID of the neuron that was removed.
 */
export function cleanupMemeticForRemovedNeuron(
  creatureExport: CreatureExport,
  neuronUUID: string,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic) return;

  // Check if neuron is in weights (as source or target) or biases
  if (memetic.weights) {
    if (memetic.weights[neuronUUID]) {
      delete creatureExport.memetic;
      return;
    }
    for (const weights of Object.values(memetic.weights)) {
      if (weights?.some((w) => w.toUUID === neuronUUID)) {
        delete creatureExport.memetic;
        return;
      }
    }
  }

  if (memetic.biases?.[neuronUUID] !== undefined) {
    delete creatureExport.memetic;
  }
}
