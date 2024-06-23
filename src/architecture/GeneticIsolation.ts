import { assert } from "@std/assert";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { Neuron } from "./Neuron.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import { Offspring } from "./Offspring.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";

/**
 * Handle the genetic isolation by grafting a neuron from one parent onto the child
 * if the child is a clone of one of the parents.
 *
 * @param child - The child creature.
 * @param mother - The mother creature.
 * @param father - The father creature.
 * @returns A Promise that resolves to the grafted creature or undefined.
 */
export async function handleGrafting(
  child: Creature,
  mother: Creature,
  father: Creature,
): Promise<Creature | undefined> {
  assert(mother.uuid);
  assert(father.uuid);

  const childUUID = await CreatureUtil.makeUUID(child);

  // Check if the offspring is a clone
  if (childUUID !== mother.uuid && childUUID !== father.uuid) return child;

  const cloneOfParent = child.uuid === mother.uuid ? mother : father;
  const otherParent = child.uuid === mother.uuid ? father : mother;

  const childExport = child.exportJSON();

  const childNeuronMap = new Map<string, Neuron>();
  const childSynapseMap = new Map<string, SynapseExport[]>();
  for (const neuron of cloneOfParent.neurons) {
    childNeuronMap.set(neuron.uuid, neuron);
    const connections = cloneOfParent.inwardConnections(neuron.index);
    childSynapseMap.set(
      neuron.uuid,
      Offspring.cloneConnections(cloneOfParent, connections),
    );
  }

  const otherNeuronMap = new Map<string, Neuron>();
  const otherSynapseMap = new Map<string, SynapseExport[]>();
  const otherSynapseMapByFromUUID = new Map<string, SynapseExport>();

  for (const neuron of otherParent.neurons) {
    otherNeuronMap.set(neuron.uuid, neuron);
    const connections = otherParent.inwardConnections(neuron.index);
    otherSynapseMap.set(
      neuron.uuid,
      Offspring.cloneConnections(otherParent, connections),
    );
  }

  for (const synapse of otherParent.exportJSON().synapses) {
    otherSynapseMapByFromUUID.set(
      synapse.fromUUID + "->" + synapse.toUUID,
      synapse,
    );
  }

  /**
   * Find possible grafting points for a missing neuron.
   */
  const possibleGraftingNeurons: NeuronExport[] = [];
  const targetGraftingPoints: Map<string, string> = new Map(); // Map to track grafting neuron -> target neuron UUID
  const memoizedRecursiveChecks = new Map<string, boolean>();

  for (const neuron of otherParent.neurons) {
    if (neuron.type === "input" || childNeuronMap.has(neuron.uuid)) continue;
    const connections = otherParent.outwardConnections(neuron.index);
    for (const connection of connections) {
      const toUUID = otherParent.neurons[connection.to].uuid;
      if (childNeuronMap.has(toUUID)) {
        // Check for recursive synapses before adding
        if (
          checkForRecursiveSynapse(
            otherParent,
            neuron.uuid,
            childNeuronMap,
            toUUID,
            memoizedRecursiveChecks,
          )
        ) {
          continue; // Skip this neuron if it creates a recursion
        }
        possibleGraftingNeurons.push(neuron.exportJSON());
        targetGraftingPoints.set(neuron.uuid, toUUID);
        break;
      }
    }
  }

  if (possibleGraftingNeurons.length === 0) {
    return undefined;
  }

  // Randomly select one of the possible grafting neurons
  const graftingNeuron = possibleGraftingNeurons[
    Math.floor(Math.random() * possibleGraftingNeurons.length)
  ];

  const targetNeuronUUID = targetGraftingPoints.get(graftingNeuron.uuid);

  if (!targetNeuronUUID) {
    throw new Error("No target neuron found for grafting");
  }

  const targetNeuronIndex = childExport.neurons.findIndex((neuron) =>
    neuron.uuid === targetNeuronUUID
  );

  if (targetNeuronIndex === -1) {
    throw new Error("No target neuron found for grafting");
  }

  // Add the neuron to the child at the target index to maintain order
  const insertedNeuron = Neuron.fromJSON(graftingNeuron, child);
  childNeuronMap.set(insertedNeuron.uuid, insertedNeuron);
  childExport.neurons.splice(targetNeuronIndex, 0, graftingNeuron);

  /**
   * Calculate the existing absolute weight of the synapses that are connected to the target grafting point neuron.
   */
  const targetNeuronConnections = childExport.synapses.filter(
    (synapse) => synapse.toUUID === targetNeuronUUID,
  );
  const totalWeight = targetNeuronConnections.reduce(
    (sum, synapse) => sum + Math.abs(synapse.weight),
    0,
  );

  /**
   * Add a new synapse to link the grafted neuron to the target grafting point neuron.
   */
  const newSynapseKey = graftingNeuron.uuid + "->" + targetNeuronUUID;
  const newSynapseFromOtherParent = otherSynapseMapByFromUUID.get(
    newSynapseKey,
  );

  if (!newSynapseFromOtherParent) {
    throw new Error(
      `No synapse found in the other parent from ${graftingNeuron.uuid} to ${targetNeuronUUID}`,
    );
  }

  childExport.synapses.push(newSynapseFromOtherParent);

  const graftingFactor = 2 * Math.random();
  /**
   * Scale the weights of the synapses that are connected to the target grafting point neuron to maintain the same total weight.
   */
  const newTotalWeight = totalWeight +
    Math.abs(newSynapseFromOtherParent.weight * graftingFactor);
  const weightScaleFactor = totalWeight / newTotalWeight;
  for (const synapse of targetNeuronConnections) {
    synapse.weight *= weightScaleFactor;
  }

  // Adjust the weight of the new synapse to maintain the overall weight balance
  const adjustedNewSynapseWeight = newSynapseFromOtherParent.weight *
    graftingFactor *
    weightScaleFactor;
  const adjustedSynapse = {
    ...newSynapseFromOtherParent,
    weight: adjustedNewSynapseWeight,
  };
  childExport.synapses[childExport.synapses.length - 1] = adjustedSynapse;

  /**
   * Recursively add missing neurons and synapses to the grafted child required by the newly inserted neuron.
   */
  function addMissingNeuronsAndSynapses(neuronUUID: string) {
    const connections = otherSynapseMap.get(neuronUUID);
    if (!connections) return;

    // Maintain the order of neurons from the other parent
    const orderedNeuronsToAdd = [];
    for (const connection of connections) {
      if (!childNeuronMap.has(connection.fromUUID)) {
        orderedNeuronsToAdd.push(connection.fromUUID);
      }
    }

    orderedNeuronsToAdd.sort((a, b) => {
      const indexA = otherParent.neurons.findIndex((neuron) =>
        neuron.uuid === a
      );
      const indexB = otherParent.neurons.findIndex((neuron) =>
        neuron.uuid === b
      );
      return indexA - indexB;
    });

    for (const fromUUID of orderedNeuronsToAdd) {
      const missingNeuron = otherNeuronMap.get(fromUUID);
      if (missingNeuron) {
        const index = childExport.neurons.findIndex((neuron) =>
          neuron.uuid === neuronUUID
        );
        childNeuronMap.set(missingNeuron.uuid, missingNeuron);
        childExport.neurons.splice(index, 0, missingNeuron.exportJSON());

        addMissingNeuronsAndSynapses(missingNeuron.uuid);
      }
    }

    for (const connection of connections) {
      if (
        !childExport.synapses.some((synapse) =>
          synapse.fromUUID === connection.fromUUID &&
          synapse.toUUID === connection.toUUID
        )
      ) {
        childExport.synapses.push(connection);
      }
    }
  }

  addMissingNeuronsAndSynapses(insertedNeuron.uuid);

  /**
   * Import the grafted child JSON to create a "real" creature and recalculate the UUID.
   */
  const graftedChild = Creature.fromJSON(childExport);
  assert(!graftedChild.uuid);
  try {
    graftedChild.validate();
  } catch (e) {
    graftedChild.DEBUG = false;
    Deno.writeTextFileSync(
      `.graftedChild.json`,
      JSON.stringify(graftedChild.exportJSON(), null, 2),
    );
    cloneOfParent.DEBUG = false;
    Deno.writeTextFileSync(
      `.cloneOfParent.json`,
      JSON.stringify(cloneOfParent.exportJSON(), null, 2),
    );
    otherParent.DEBUG = false;
    Deno.writeTextFileSync(
      `.otherParent.json`,
      JSON.stringify(otherParent.exportJSON(), null, 2),
    );
    throw e;
  }
  // console.log(
  //   `Grafting new child from mother: ${
  //     mother.uuid?.substring(0, 8)
  //   } and father: ${father.uuid?.substring(0, 8)}`,
  // );

  return graftedChild;
}

/**
 * Check for recursive synapses in the given child export.
 *
 * @param otherParent - The parent from which the neuron is being grafted.
 * @param neuronUUID - The UUID of the neuron being checked.
 * @param childNeuronMap - Map of neurons in the child.
 * @param targetUUID - The UUID of the target neuron for grafting.
 * @param memoizedRecursiveChecks - Map to memoize recursive checks.
 * @returns True if a recursive synapse is detected, otherwise false.
 */
function checkForRecursiveSynapse(
  otherParent: Creature,
  neuronUUID: string,
  childNeuronMap: Map<string, Neuron>,
  targetUUID: string,
  memoizedRecursiveChecks: Map<string, boolean>,
): boolean {
  const stack = [neuronUUID];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const currentNeuronUUID = stack.pop()!;
    if (memoizedRecursiveChecks.has(currentNeuronUUID)) {
      if (memoizedRecursiveChecks.get(currentNeuronUUID)!) {
        return true;
      }
      continue;
    }

    if (visited.has(currentNeuronUUID)) {
      memoizedRecursiveChecks.set(currentNeuronUUID, false);
      continue;
    }
    visited.add(currentNeuronUUID);

    const indx = otherParent.neurons.findIndex((neuron) =>
      neuron.uuid === currentNeuronUUID
    );
    if (indx === undefined) continue; // Neuron not found

    const outward = otherParent.outwardConnections(indx);
    for (const connection of outward) {
      const toNeuron = otherParent.neurons[connection.to];
      const toUUID = toNeuron.uuid;
      if (toUUID === targetUUID) continue; // That's okay, we're grafting to this neuron
      if (toNeuron.type === "output") continue; // That's okay, all creatures have output neurons

      if (childNeuronMap.has(toUUID)) {
        memoizedRecursiveChecks.set(currentNeuronUUID, true);
        return true; // Found a connection to an existing child neuron
      }

      stack.push(toUUID);
    }

    const inward = otherParent.inwardConnections(indx);
    for (const connection of inward) {
      const fromNeuron = otherParent.neurons[connection.from];
      if (fromNeuron.type === "input") continue; // That's okay, all creatures have input neurons
      const fromUUID = fromNeuron.uuid;

      if (childNeuronMap.has(fromUUID)) {
        memoizedRecursiveChecks.set(currentNeuronUUID, true);
        return true; // Found a connection to an existing child neuron
      }
      stack.push(fromUUID);
    }

    memoizedRecursiveChecks.set(currentNeuronUUID, false);
  }

  return false;
}
