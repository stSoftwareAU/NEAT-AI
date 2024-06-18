import { assert } from "@std/assert";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import { Offspring } from "./Offspring.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";
import { Neuron } from "./Neuron.ts";

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
  for (const neuron of otherParent.neurons) {
    if (neuron.type === "input" || childNeuronMap.has(neuron.uuid)) continue;
    const connections = otherParent.outwardConnections(neuron.index);
    for (const connection of connections) {
      const toUUID = otherParent.neurons[connection.to].uuid;
      if (childNeuronMap.has(toUUID)) {
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

  // Add the neuron to the child
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

  /**
   * Scale the weights of the synapses that are connected to the target grafting point neuron to maintain the same total weight.
   */
  const weightScaleFactor = totalWeight /
    (totalWeight + Math.abs(newSynapseFromOtherParent.weight));
  for (const synapse of targetNeuronConnections) {
    synapse.weight *= weightScaleFactor;
  }

  /**
   * Recursively add missing neurons and synapses to the grafted child required by the newly inserted neuron.
   */
  function addMissingNeuronsAndSynapses(neuronUUID: string) {
    const connections = otherSynapseMap.get(neuronUUID);
    if (!connections) return;

    for (const connection of connections) {
      if (!childNeuronMap.has(connection.fromUUID)) {
        const missingNeuron = otherNeuronMap.get(connection.fromUUID);
        if (missingNeuron) {
          const index = childExport.neurons.findIndex((neuron) =>
            neuron.uuid === neuronUUID
          );
          childNeuronMap.set(missingNeuron.uuid, missingNeuron);
          childExport.neurons.splice(index, 0, missingNeuron.exportJSON());

          addMissingNeuronsAndSynapses(missingNeuron.uuid);
        }
      }
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
  graftedChild.validate();
  assert(!graftedChild.uuid);
  // await CreatureUtil.makeUUID(graftedChild);

  console.log("Grafting new child due to genetic isolation (clone)");

  return graftedChild;
}
