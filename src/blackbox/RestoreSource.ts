import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../mod.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import type { Approach } from "../NEAT/LogApproach.ts";

/**
 * Restores a creature from its memetic source data.
 *
 * This function takes a creature that has been modified through memetic learning
 * and restores it to a state based on the original memetic data. It applies
 * the stored biases and weights from the memetic interface to create a new
 * creature instance.
 *
 * @param creature - The creature to restore from memetic data
 * @returns A new creature instance with restored memetic data, or undefined if no memetic data exists
 * @throws {Error} When memetic data references non-existent neurons
 *
 * @example
 * ```ts
 * const restoredCreature = restoreSource(creature);
 * if (restoredCreature) {
 *   getLogger().info("Creature restored from memetic data");
 * }
 * ```
 */
export function restoreSource(creature: Creature): Creature | undefined {
  if (!creature.memetic) return;

  const restoredCreature = creature.exportJSON();
  const memetic = creature.memetic;

  // Restore biases from memetic
  for (const neuronId in memetic.biases) {
    const bias = memetic.biases[neuronId];
    const neuron = restoredCreature.neurons.find((n) =>
      n.id === Number(neuronId)
    );
    if (!neuron) {
      throw new ValidationError(
        `Neuron with UUID ${neuronId} not found in the creature.`,
        "OTHER",
      );
    }
    neuron.bias = bias;
  }

  // Restore weights from memetic
  for (const fromId in memetic.weights) {
    const weightArray = memetic.weights[fromId];
    weightArray.forEach((weightObj) => {
      let synapse = restoredCreature.synapses.find((s) =>
        s.fromId === Number(fromId) && s.toId === weightObj.toId
      );
      assert(Number.isFinite(weightObj.weight), "weight must be a number");
      if (!synapse) {
        synapse = {
          fromId: Number(fromId),
          toId: weightObj.toId,
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
