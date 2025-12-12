import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";

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
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @returns The number of neurons removed.
 */
export function cleanupOrphanedNeurons(creatureExport: CreatureExport): number {
  let totalRemoved = 0;
  let changedThisPass: boolean;

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
          // The bias becomes the constant value (already "squashed" by having no input)
          creatureExport.neurons[i] = {
            type: "constant",
            uuid: neuron.uuid,
            bias: neuron.bias,
          };
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

  return totalRemoved;
}

/**
 * Cleans up orphaned neurons from a live Creature instance.
 *
 * This is a convenience wrapper that exports the creature to JSON,
 * calls cleanupOrphanedNeurons, and reloads the creature.
 *
 * @param creature - The Creature to clean up (modified in place).
 * @returns The number of neurons removed.
 */
export function cleanupOrphanedNeuronsInCreature(creature: Creature): number {
  const exportJSON = creature.exportJSON();
  const removed = cleanupOrphanedNeurons(exportJSON);

  if (removed > 0) {
    creature.loadFrom(exportJSON, true);
  }

  return removed;
}
