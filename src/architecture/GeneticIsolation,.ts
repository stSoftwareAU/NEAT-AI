import { assert } from "@std/assert";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";
import { Offspring } from "./Offspring.ts";
import type { SynapseExport } from "./SynapseInterfaces.ts";

export async function handleGeneticIsolation(
  child: Creature,
  mother: Creature,
  father: Creature,
): Promise<Creature> {
  assert(mother.uuid);
  assert(father.uuid);

  const childUUID = await CreatureUtil.makeUUID(child);

  // Check if the offspring is a clone
  if (childUUID !== mother.uuid && childUUID !== father.uuid) return child;

  const cloneOfParent = child.uuid === mother.uuid ? father : mother;
  const otherParent = child.uuid === mother.uuid ? mother : father;

  const childExport = child.exportJSON();

  const childNeuronMap = new Map<string, NeuronExport>();
  const childConnectionsMap = new Map<string, SynapseExport[]>();
  cloneOfParent.neurons.filter((neuron) => neuron.type !== "input").forEach(
    (neuron) => {
      childNeuronMap.set(neuron.uuid, neuron.exportJSON());
      const connections = cloneOfParent.inwardConnections(neuron.index);
      childConnectionsMap.set(
        neuron.uuid,
        Offspring.cloneConnections(cloneOfParent, connections),
      );
    },
  );

  const otherNeuronMap = new Map<string, NeuronExport>();
  const otherConnectionsMap = new Map<string, SynapseExport[]>();
  otherParent.neurons.filter((neuron) => neuron.type !== "input").forEach(
    (neuron) => {
      otherNeuronMap.set(neuron.uuid, neuron.exportJSON());
      const connections = otherParent.inwardConnections(neuron.index);
      otherConnectionsMap.set(
        neuron.uuid,
        Offspring.cloneConnections(otherParent, connections),
      );
    },
  );

  /**
   * Find possible insertion points for a missing neuron.
   * Insert the missing neuron before the mutated child's target insertion point neuron.
   */
  const possibleInsertionNeurons: NeuronExport[] = [];
  for (const neuron of otherParent.neurons) {
    const connections = otherParent.outwardConnections(neuron.index);
    for (const connection of connections) {
      const toUUID = otherParent.neurons[connection.to].uuid;
      if (childNeuronMap.has(toUUID)) {
        possibleInsertionNeurons.push(neuron.exportJSON());
        break;
      }
    }
  }
  if (possibleInsertionNeurons.length === 0) {
    throw new Error("No suitable neuron found for insertion");
  }

  // Randomly select one of the possible insertion neurons
  const insertionNeuron = possibleInsertionNeurons[
    Math.floor(Math.random() * possibleInsertionNeurons.length)
  ];

  // Find the index to insert the neuron in the child
  const targetNeuronIndex = childExport.neurons.findIndex((neuron) =>
    neuron.uuid === insertionNeuron.uuid
  );
  if (targetNeuronIndex === -1) {
    throw new Error("No target neuron found for insertion");
  }

  /**
   * Calculate the existing absolute weight of the synapses that are connected to the target insertion point neuron.
   */
  const targetNeuronUUID = childExport.neurons[targetNeuronIndex].uuid;
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
  const newSynapse: SynapseExport = {
    fromUUID: insertionNeuron.uuid,
    toUUID: targetNeuronUUID,
    weight: Math.random() - 0.5, // Random weight between -0.5 and 0.5
  };
  childExport.synapses.push(newSynapse);

  /**
   * Scale the weights of the synapses that are connected to the target insertion point neuron to maintain the same total weight.
   */
  targetNeuronConnections.forEach((synapse) => {
    synapse.weight = (synapse.weight / totalWeight) *
      (totalWeight - Math.abs(newSynapse.weight));
  });

  // Add the neuron to the child
  childExport.neurons.splice(targetNeuronIndex, 0, insertionNeuron);

  /**
   * Recursively add missing neurons and synapses to the mutated child required by the newly inserted neuron.
   */
  function addMissingNeuronsAndSynapses(neuronUUID: string) {
    const connections = otherConnectionsMap.get(neuronUUID);
    if (!connections) return;

    connections.forEach((connection) => {
      if (!childNeuronMap.has(connection.fromUUID)) {
        const missingNeuron = otherNeuronMap.get(connection.fromUUID);
        if (missingNeuron) {
          childExport.neurons.push(missingNeuron);
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

  addMissingNeuronsAndSynapses(insertionNeuron.uuid);

  /**
   * Import the mutated child JSON to create a "real" creature and recalculate the UUID.
   */
  const mutatedChild = Creature.fromJSON(childExport);
  assert(!mutatedChild.uuid);
  await CreatureUtil.makeUUID(mutatedChild);

  return mutatedChild;
}
