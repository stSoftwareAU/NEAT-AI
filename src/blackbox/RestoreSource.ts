import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../mod.ts";
import type { Approach } from "@neat/LogApproach.ts";
import { CreatureExportBuilder } from "@utils/CreatureExportBuilder.ts";

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

  const restoredCreature = new CreatureExportBuilder(creature).build(true);
  const memetic = creature.memetic;
  const idToWire = new Map<number, string>();

  for (let i = 0; i < creature.input; i++) {
    idToWire.set(i, `input-${i}`);
  }
  let outputIndex = 0;
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "input") return;
    if (neuron.type === "output") {
      idToWire.set(neuron.id, `output-${outputIndex}`);
      outputIndex++;
      return;
    }
    idToWire.set(neuron.id, neuron.uuid ?? `legacy-neuron-${neuron.id}`);
  });

  // Restore biases from memetic
  for (const neuronId in memetic.biases) {
    const bias = memetic.biases[neuronId];
    const neuronUuid = idToWire.get(Number(neuronId));
    if (!neuronUuid) {
      return undefined;
    }
    const neuron = restoredCreature.neurons.find((n) => n.uuid === neuronUuid);
    if (!neuron) {
      return undefined;
    }
    neuron.bias = bias;
  }

  // Restore weights from memetic
  for (const fromId in memetic.weights) {
    const weightArray = memetic.weights[fromId];
    const fromUUID = idToWire.get(Number(fromId));
    if (!fromUUID) {
      return undefined;
    }
    for (const weightObj of weightArray) {
      const toUUID = idToWire.get(weightObj.toId);
      if (!toUUID) {
        return undefined;
      }
      let synapse = restoredCreature.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === toUUID
      );
      assert(Number.isFinite(weightObj.weight), "weight must be a number");
      if (!synapse) {
        synapse = {
          fromUUID,
          toUUID,
          weight: weightObj.weight,
        };
        restoredCreature.synapses.push(synapse);
      } else {
        synapse.weight = weightObj.weight;
      }
    }
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
