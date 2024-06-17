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
  cloneOfParent.neurons.forEach((neuron) => {
    childNeuronMap.set(neuron.uuid, neuron);
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
  for (
    const neuron of otherParent.neurons
  ) {
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
    console.warn("No suitable neuron found for insertion");
    return child;
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

  console.log(
    `Inserting neuron ${insertionNeuron.uuid} before ${targetNeuronUUID}`,
  );

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
  const newSynapseFromOtherParent = otherParent.exportJSON().synapses.find(
    (synapse) =>
      synapse.fromUUID === insertionNeuron.uuid &&
      synapse.toUUID === targetNeuronUUID,
  );

  if (!newSynapseFromOtherParent) {
    throw new Error(
      `No synapse found in the other parent from ${insertionNeuron.uuid} to ${targetNeuronUUID}`,
    );
  }

  childExport.synapses.push(newSynapseFromOtherParent);
  console.log(
    `Inserting new synapse from ${newSynapseFromOtherParent.fromUUID} to ${newSynapseFromOtherParent.toUUID}`,
  );

  /**
   * Scale the weights of the synapses that are connected to the target insertion point neuron to maintain the same total weight.
   */
  targetNeuronConnections.forEach((synapse) => {
    synapse.weight = (synapse.weight / totalWeight) *
      (totalWeight - Math.abs(newSynapseFromOtherParent.weight));
  });

  /**
   * Recursively add missing neurons and synapses to the mutated child required by the newly inserted neuron.
   */
  function addMissingNeuronsAndSynapses(neuronUUID: string) {
    const connections = otherConnectionsMap.get(neuronUUID);
    if (!connections) return;

    console.log(`Adding missing neurons and synapses for ${neuronUUID}`);

    connections.forEach((connection) => {
      if (!childNeuronMap.has(connection.fromUUID)) {
        const missingNeuron = otherNeuronMap.get(connection.fromUUID);
        if (missingNeuron) {
          const index = childExport.neurons.findIndex((neuron) =>
            neuron.uuid === neuronUUID
          );
          childNeuronMap.set(missingNeuron.uuid, missingNeuron);
          childExport.neurons.splice(index, 0, missingNeuron.exportJSON());
          console.log(`Added missing neuron ${missingNeuron.uuid}`);
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
        console.log(
          `Added missing synapse from ${connection.fromUUID} to ${connection.toUUID}`,
        );
      }
    });
  }

  addMissingNeuronsAndSynapses(insertedNeuron.uuid);

  console.info(
    `Child has ${childExport.neurons.length} neurons and ${childExport.synapses.length} synapses`,
  );
  /**
   * Import the mutated child JSON to create a "real" creature and recalculate the UUID.
   */
  const mutatedChild = Creature.fromJSON(childExport);
  mutatedChild.validate();
  assert(!mutatedChild.uuid);
  await CreatureUtil.makeUUID(mutatedChild);

  return mutatedChild;
}
