import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";

/**
 * Result of cleaning up orphaned neurons.
 */
export interface CleanupOrphanedResult {
  /** Number of neurons removed. */
  removed: number;
  /** Number of hidden neurons converted to constants. */
  converted: number;
}

export function createConstantOne(creature: Creature, count: number) {
  let uuid;
  switch (count) {
    case 1:
      uuid = "second-one";
      break;
    case 2:
      uuid = "third-one";
      break;
    default:
      uuid = "first-one";
  }
  let firstHiddenIndx = -1;
  let foundConstant;
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const n = creature.neurons[indx];
    if (firstHiddenIndx === -1) {
      if (n.type === "hidden") {
        firstHiddenIndx = n.index;
      }
    }
    if (n.uuid === uuid) {
      assert(n.type === "constant", "Must be a constant");
      foundConstant = n;
      foundConstant.bias = 1;
      if (firstHiddenIndx === -1) {
        firstHiddenIndx = foundConstant.index;
      }

      break;
    }
  }

  const constantOne = new Neuron(
    uuid,
    "constant",
    1,
    creature,
    undefined,
  );
  constantOne.index = firstHiddenIndx;
  const left = creature.neurons.slice(0, firstHiddenIndx);
  const right = creature.neurons.slice(firstHiddenIndx);
  right.forEach((n) => {
    n.index++;
  });
  creature.neurons = [...left, constantOne, ...right];

  creature.synapses.forEach((c) => {
    if (c.from >= firstHiddenIndx) c.from++;
    if (c.to >= firstHiddenIndx) c.to++;
  });

  if (foundConstant) {
    let firstIndx = -1;
    for (let indx = creature.input; indx < creature.neurons.length; indx++) {
      const n = creature.neurons[indx];
      if (n.uuid === uuid) {
        if (firstIndx === -1) {
          firstIndx = n.index;
        } else {
          creature.synapses.forEach((c) => {
            if (c.from === n.index) {
              c.from = firstIndx;
            }
          });

          creature.clearCache();
          removeHiddenNeuron(creature, n.index);
          break;
        }
      }
    }

    creature.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      } else {
        return a.from - b.from;
      }
    });
  }

  creature.clearCache();

  return constantOne;
}

/**
 *  Removes a node from the creature
 */
export function removeHiddenNeuron(creature: Creature, indx: number) {
  assert(indx >= 0, "Must be a positive integer");

  delete creature.memetic;
  const neuron = creature.neurons[indx];

  assert(
    neuron.type === "constant" || neuron.type === "hidden",
    "Node must be a 'constant' or 'hidden' type",
  );
  const left = creature.neurons.slice(0, indx);
  const right = creature.neurons.slice(indx + 1);
  right.forEach((item) => {
    item.index--;
  });

  const full = [...left, ...right];

  creature.neurons = full;

  const tmpConnections: Synapse[] = [];

  creature.synapses.forEach((c) => {
    if (c.from !== indx) {
      if (c.from > indx) c.from--;
      if (c.to !== indx) {
        if (c.to > indx) c.to--;

        tmpConnections.push(c);
      }
    }
  });

  creature.synapses = tmpConnections;

  // Maintain sorted order: by 'from' index, then by 'to' index
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) {
      return a.to - b.to;
    } else {
      return a.from - b.from;
    }
  });

  creature.clearCache();
}

/**
 * Cleans up orphaned neurons from a CreatureExport.
 *
 * This function handles two types of orphaned neurons:
 * 1. Hidden/constant neurons with no outward connections - these are removed
 * 2. Hidden neurons with no inward connections but with outward connections -
 *    these are converted to constants
 *
 * This can occur when a neuron is removed and other neurons that only
 * connected to/from it are left dangling.
 *
 * This function modifies the CreatureExport in place. The cleanup is performed
 * iteratively until no more orphaned neurons are found (cascade removal).
 *
 * Also cleans up memetic data references to removed neurons.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @returns The cleanup result with counts of removed and converted neurons.
 */
export function cleanupOrphanedNeurons(
  creatureExport: CreatureExport,
): CleanupOrphanedResult {
  let totalRemoved = 0;
  let totalConverted = 0;
  let changedThisPass: boolean;
  const allRemovedUUIDs = new Set<string>();

  do {
    changedThisPass = false;

    // Build sets for connection analysis
    const neuronsWithOutwardConnections = new Set<string>();
    const neuronsWithInwardConnections = new Set<string>();
    for (const synapse of creatureExport.synapses) {
      neuronsWithOutwardConnections.add(synapse.fromUUID);
      neuronsWithInwardConnections.add(synapse.toUUID);
    }

    // First pass: Convert hidden neurons with no inward connections (but have outward) to constants
    for (let i = 0; i < creatureExport.neurons.length; i++) {
      const neuron = creatureExport.neurons[i];
      if (neuron.type === "hidden") {
        if (
          !neuronsWithInwardConnections.has(neuron.uuid) &&
          neuronsWithOutwardConnections.has(neuron.uuid)
        ) {
          // Has outward connections but no inward - convert to constant
          // A hidden neuron with bias X and squash function outputs squash(0 + X)
          // when receiving no input, so we must apply the squash function to get
          // the correct constant value.
          let constantBias = neuron.bias;
          if (neuron.squash) {
            const squashFn = Activations.find(neuron.squash);
            const activation = squashFn as ActivationInterface;
            if (activation?.squash) {
              constantBias = activation.squash(neuron.bias);
            }
          }
          creatureExport.neurons[i] = {
            type: "constant",
            uuid: neuron.uuid,
            bias: constantBias,
          };
          totalConverted++;
          changedThisPass = true;
        }
      }
    }

    // Second pass: Find and remove neurons with no outward connections
    const orphanedUUIDs: string[] = [];
    for (const neuron of creatureExport.neurons) {
      if (neuron.type === "hidden" || neuron.type === "constant") {
        if (!neuronsWithOutwardConnections.has(neuron.uuid)) {
          orphanedUUIDs.push(neuron.uuid);
        }
      }
    }

    if (orphanedUUIDs.length > 0) {
      const orphanSet = new Set(orphanedUUIDs);

      // Track all removed UUIDs for memetic cleanup
      for (const uuid of orphanedUUIDs) {
        allRemovedUUIDs.add(uuid);
      }

      // Remove orphaned neurons
      creatureExport.neurons = creatureExport.neurons.filter(
        (n) => !orphanSet.has(n.uuid),
      );

      // Remove synapses that connect TO orphaned neurons
      creatureExport.synapses = creatureExport.synapses.filter(
        (s) => !orphanSet.has(s.toUUID),
      );

      totalRemoved += orphanedUUIDs.length;
      changedThisPass = true;
    }
  } while (changedThisPass);

  // Delete memetic if any neurons were removed (structure changed)
  if (allRemovedUUIDs.size > 0) {
    delete creatureExport.memetic;
  }

  return { removed: totalRemoved, converted: totalConverted };
}

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

/**
 * Cleans up orphaned neurons from a live Creature instance.
 *
 * This is a convenience wrapper that exports the creature to JSON (without
 * validation, to allow intermediate invalid states), calls cleanupOrphanedNeurons,
 * and reloads the creature if any modifications were made.
 *
 * This function handles:
 * 1. Converting hidden neurons with no inward connections to constants
 * 2. Removing hidden/constant neurons with no outward connections
 *
 * @param creature - The Creature to clean up (modified in place).
 * @returns The cleanup result with counts of removed and converted neurons.
 */
export function cleanupOrphanedNeuronsInCreature(
  creature: Creature,
): CleanupOrphanedResult {
  // Use the builder directly to bypass validation (creature may be in an intermediate state)
  const builder = new CreatureExportBuilder(creature);
  const exportJSON = builder.build();

  const result = cleanupOrphanedNeurons(exportJSON);

  if (result.removed > 0 || result.converted > 0) {
    creature.loadFrom(exportJSON, true);
  }

  return result;
}
