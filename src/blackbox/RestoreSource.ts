import { addTag } from "@stsoftware/tags";
import { Creature } from "../../mod.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import { assert } from "@std/assert/assert";

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
      let synapse = restoredCreature.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === weightObj.toUUID
      );
      assert(Number.isFinite(weightObj.weight), "weight must be a number");
      if (!synapse) {
        synapse = {
          fromUUID: fromUUID,
          toUUID: weightObj.toUUID,
          weight: weightObj.weight,
        };
        restoredCreature.synapses.push(synapse);
      } else {
        synapse.weight = weightObj.weight;
      }
    });
  }
  addTag(restoredCreature, "restored", memetic.generation.toString());
  addTag(restoredCreature, "approach", "fine" as Approach);
  addTag(restoredCreature, "approach-logged", "fine" as Approach);

  if (!creature.score || memetic.score < creature.score) {
    addTag(restoredCreature, "score", memetic.score.toString());
  }

  const realCreature = Creature.fromJSON(restoredCreature);

  realCreature.score = memetic.score;
  return realCreature;
}
