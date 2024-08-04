import { Creature } from "../../mod.ts";

export function restoreSource(creature: Creature): Creature | undefined {
  if (!creature.memetic) return;

  const restoredCreature = creature.exportJSON();
  const memetic = creature.memetic;

  // Restore biases from memetic
  for (const neuronUUID in memetic.biases) {
    const bias = memetic.biases[neuronUUID];
    const neuron = restoredCreature.neurons.find((n) => n.uuid === neuronUUID);
    if (!neuron) {
      throw new Error(
        `Neuron with UUID ${neuronUUID} not found in the creature.`,
      );
    }
    neuron.bias = bias;
  }

  // Restore weights from memetic
  for (const fromUUID in memetic.weights) {
    const weightArray = memetic.weights[fromUUID];
    weightArray.forEach((weightObj) => {
      const synapse = restoredCreature.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === weightObj.toUUID
      );
      if (!synapse) {
        throw new Error(
          `Synapse from ${fromUUID} to ${weightObj.toUUID} not found in the creature.`,
        );
      }
      synapse.weight = weightObj.weight;
    });
  }

  return Creature.fromJSON(restoredCreature);
}
