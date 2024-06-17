import { assert } from "@std/assert";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import { Offspring } from "./Offspring.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";
import { Neuron } from "./Neuron.ts";

export async function handleGeneticIsolation(
  child: Creature,
  mother: Creature,
  father: Creature,
): Promise<Creature | undefined> {
  assert(mother.uuid);
  assert(father.uuid);

  const childUUID = await CreatureUtil.makeUUID(child);

  // Check if the offspring is a clone
  if (childUUID !== mother.uuid && childUUID !== father.uuid) return child;

  console.log("Creating a new child due to genetic isolation(clone)");

  const cloneOfParent = child.uuid === mother.uuid ? mother : father;
  const otherParent = child.uuid === mother.uuid ? father : mother;

  const childExport = child.exportJSON();

  const childNeuronMap = new Map<string, Neuron>();
  const childSynapseMap = new Map<string, SynapseExport[]>();
  cloneOfParent.neurons.forEach((neuron) => {
    childNeuronMap.set(neuron.uuid, neuron);
    const connections = cloneOfParent.inwardConnections(neuron.index);
    childSynapseMap.set(
      neuron.uuid,
      Offspring.cloneConnections(cloneOfParent, connections),
    );
  });

  const otherNeuronMap = new Map<string, Neuron>();
  const otherSynapseMap = new Map<string, SynapseExport[]>();
  otherParent.neurons.forEach((neuron) => {
    otherNeuronMap.set(neuron.uuid, neuron);
    const connections = otherParent.inwardConnections(neuron.index);
    otherSynapseMap.set(
      neuron.uuid,
      Offspring.cloneConnections(otherParent, connections),
    );
  });

  const otherSynapses = otherParent.exportJSON().synapses;
  const otherSynapseMapByFromUUID = new Map<string, SynapseExport>();
  otherSynapses.forEach((synapse) => {
    otherSynapseMapByFromUUID.set(
      synapse.fromUUID + "->" + synapse.toUUID,
      synapse,
    );
  });

  /**
   * Find possible insertion points for a missing neuron.
   */
  const possibleInsertionNeurons: NeuronExport[] = [];
  const targetInsertionPoints: Map<string, string> = new Map(); // Map to track insertion neuron -> target neuron UUID
  for (const neuron of otherParent.neurons) {
    if (neuron.type === "input" || childNeuronMap.has(neuron.uuid)) continue;
    const connections = otherParent.outwardConnections(neuron.index);
    for (const connection of connections) {
      const toUUID = otherParent.neurons[connection.to].uuid;
      if (childNeuronMap.has(toUUID)) {
        possibleInsertionNeurons.push(neuron.exportJSON());
        targetInsertionPoints.set(neuron.uuid, toUUID);
        break;
      }
    }
  }

  if (possibleInsertionNeurons.length === 0) {
    return undefined;
  }

  // Randomly select one of the possible insertion neurons
  const insertionNeuron = possibleInsertionNeurons[
    Math.floor(Math.random() * possibleInsertionNeurons.length)
  ];

  const targetNeuronUUID = targetInsertionPoints.get(insertionNeuron.uuid);

  if (!targetNeuronUUID) {
    throw new Error("No target neuron found for insertion");
  }

  const targetNeuronIndex = childExport.neurons.findIndex((neuron) =>
    neuron.uuid === targetNeuronUUID
  );

  if (targetNeuronIndex === -1) {
    throw new Error("No target neuron found for insertion");
  }

  // Add the neuron to the child
  const insertedNeuron = Neuron.fromJSON(insertionNeuron, child);
  childNeuronMap.set(insertedNeuron.uuid, insertedNeuron);
  childExport.neurons.splice(targetNeuronIndex, 0, insertionNeuron);

  /**
   * Calculate the existing absolute weight of the synapses that are connected to the target insertion point neuron.
   */
  const targetNeuronConnections = childExport.synapses.filter(
    (synapse) => synapse.toUUID === targetNeuronUUID,
  );
  const totalWeight = targetNeuronConnections.reduce(
    (sum, synapse) => sum + Math.abs(synapse.weight),
    0,
  );

  /**
   * Add a new synapse to link the inserted neuron to the target insertion point neuron.
   */
  const newSynapseKey = insertionNeuron.uuid + "->" + targetNeuronUUID;
  const newSynapseFromOtherParent = otherSynapseMapByFromUUID.get(
    newSynapseKey,
  );

  if (!newSynapseFromOtherParent) {
    throw new Error(
      `No synapse found in the other parent from ${insertionNeuron.uuid} to ${targetNeuronUUID}`,
    );
  }

  childExport.synapses.push(newSynapseFromOtherParent);

  /**
   * Scale the weights of the synapses that are connected to the target insertion point neuron to maintain the same total weight.
   */
  const weightScaleFactor = totalWeight /
    (totalWeight + Math.abs(newSynapseFromOtherParent.weight));
  targetNeuronConnections.forEach((synapse) => {
    synapse.weight *= weightScaleFactor;
  });

  /**
   * Recursively add missing neurons and synapses to the mutated child required by the newly inserted neuron.
   */
  function addMissingNeuronsAndSynapses(neuronUUID: string) {
    const connections = otherSynapseMap.get(neuronUUID);
    if (!connections) return;

    connections.forEach((connection) => {
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
    });
  }

  addMissingNeuronsAndSynapses(insertedNeuron.uuid);

  /**
   * Import the mutated child JSON to create a "real" creature and recalculate the UUID.
   */
  const mutatedChild = Creature.fromJSON(childExport);
  // mutatedChild.validate();
  // assert(!mutatedChild.uuid);
  // await CreatureUtil.makeUUID(mutatedChild);

  return mutatedChild;
}
