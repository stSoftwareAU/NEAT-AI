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
): Promise<Creature> {
  assert(mother.uuid);
  assert(father.uuid);

  const childUUID = await CreatureUtil.makeUUID(child);

  // Check if the offspring is a clone
  if (childUUID !== mother.uuid && childUUID !== father.uuid) return child;

  console.log("Creating a new child due to genetic isolation");

  const cloneOfParent = child.uuid === mother.uuid ? mother : father;
  const otherParent = child.uuid === mother.uuid ? father : mother;

  const childExport = child.exportJSON();

  const childNeuronMap = new Map<string, Neuron>();
  const childConnectionsMap = new Map<string, SynapseExport[]>();
  cloneOfParent.neurons.forEach((neuron) => {
    childNeuronMap.set(neuron.uuid, neuron);
    const connections = cloneOfParent.inwardConnections(neuron.index);
    childConnectionsMap.set(
      neuron.uuid,
      Offspring.cloneConnections(cloneOfParent, connections),
    );
  });

  const otherNeuronMap = new Map<string, Neuron>();
  const otherConnectionsMap = new Map<string, SynapseExport[]>();
  otherParent.neurons.forEach((neuron) => {
    otherNeuronMap.set(neuron.uuid, neuron);
    const connections = otherParent.inwardConnections(neuron.index);
    otherConnectionsMap.set(
      neuron.uuid,
      Offspring.cloneConnections(otherParent, connections),
    );
  });

  /**
   * Find possible insertion points for a missing neuron.
   */
  const possibleInsertionNeurons: NeuronExport[] = [];
  const targetInsertionPoints: Map<string, string> = new Map(); // Map to track insertion neuron -> target neuron UUID
  for (const neuron of otherParent.neurons) {
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
    throw new Error("No suitable neuron found for insertion");
  }

  console.info(
    "Possible insertion neurons:",
    possibleInsertionNeurons.map((neuron) => neuron.uuid),
  );

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
  const insertedNeuron = Neuron.fromJSON(insertionNeuron, child);
  childNeuronMap.set(insertedNeuron.uuid, insertedNeuron);
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
          childNeuronMap.set(missingNeuron.uuid, missingNeuron);
          childExport.neurons.push(missingNeuron.exportJSON());
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
   * Ensure that neurons from both parents are present in the child
   */
  function addNeuronsFromParent(
    parent: Creature,
    neuronMap: Map<string, Neuron>,
    connectionsMap: Map<string, SynapseExport[]>,
  ) {
    parent.neurons.filter((neuron) => neuron.type !== "input").forEach(
      (neuron) => {
        if (!neuronMap.has(neuron.uuid)) {
          neuronMap.set(neuron.uuid, neuron);
          childExport.neurons.push(neuron.exportJSON());
          const connections = parent.inwardConnections(neuron.index);
          connectionsMap.set(
            neuron.uuid,
            Offspring.cloneConnections(parent, connections),
          );
          addMissingNeuronsAndSynapses(neuron.uuid);
        }
      },
    );
  }

  addNeuronsFromParent(mother, childNeuronMap, childConnectionsMap);
  addNeuronsFromParent(father, childNeuronMap, childConnectionsMap);

  // Ensure all neurons have outgoing and incoming connections
  childExport.neurons = childExport.neurons.filter((neuron) => {
    const inwardConnections = childExport.synapses.filter(
      (synapse) => synapse.toUUID === neuron.uuid,
    );
    const outwardConnections = childExport.synapses.filter(
      (synapse) => synapse.fromUUID === neuron.uuid,
    );

    return inwardConnections.length > 0 &&
      (outwardConnections.length > 0 || neuron.type === "output");
  });

  // Remove duplicate neurons
  const uniqueNeurons = Array.from(
    new Set(childExport.neurons.map((neuron) => JSON.stringify(neuron))),
  ).map((neuron) => JSON.parse(neuron));

  childExport.neurons = uniqueNeurons;

  /**
   * Ensure forward-only order of synapses.
   */
  const neuronUUIDToIndex = new Map(
    childExport.neurons.map((neuron, index) => [neuron.uuid, index]),
  );

  childExport.synapses = childExport.synapses.filter(
    (synapse) => {
      const fromIndex = neuronUUIDToIndex.get(synapse.fromUUID);
      const toIndex = neuronUUIDToIndex.get(synapse.toUUID);
      return fromIndex !== undefined && toIndex !== undefined &&
        fromIndex < toIndex;
    },
  );

  /**
   * Import the mutated child JSON to create a "real" creature and recalculate the UUID.
   */
  const mutatedChild = Creature.fromJSON(childExport);
  assert(!mutatedChild.uuid);
  await CreatureUtil.makeUUID(mutatedChild);

  return mutatedChild;
}
