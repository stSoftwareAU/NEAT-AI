import { assert } from "@std/assert/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";

/**
 * Compacts a creature by removing redundant neurons and connections.
 *
 * @param creature - The creature to compact
 * @param feedbackLoop - Whether to use a feedback loop during compaction
 * @returns A new compacted creature or undefined if no compaction occurred
 */
export function compactCreature(
  creature: Creature,
  feedbackLoop: boolean,
): Creature | undefined {
  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  const startExport = creature.exportJSON();
  creature.DEBUG = holdDebug;

  const compactCreature = JSON.parse(
    JSON.stringify(startExport),
  ) as CreatureExport;

  const neuronMap = new Map<string, NeuronExport>();
  compactCreature.neurons.forEach((neuron) =>
    neuronMap.set(neuron.uuid, neuron)
  );

  const inwardConnections = new Map<string, SynapseExport[]>();
  const outwardConnections = new Map<string, SynapseExport[]>();

  compactCreature.synapses.forEach((synapse) => {
    outwardConnections.set(
      synapse.fromUUID,
      (outwardConnections.get(synapse.fromUUID) || []).concat(synapse),
    );
    inwardConnections.set(
      synapse.toUUID,
      (inwardConnections.get(synapse.toUUID) || []).concat(synapse),
    );
  });

  let didCompact = false;

  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;

    const inConns = inwardConnections.get(neuron.uuid) || [];
    const outConns = outwardConnections.get(neuron.uuid) || [];

    if (inConns.length === 1 && outConns.length === 1) {
      const [inConn] = inConns;
      const [outConn] = outConns;

      const fromNeuron = neuronMap.get(inConn.fromUUID);
      const toNeuron = neuronMap.get(outConn.toUUID);

      if (
        fromNeuron &&
        toNeuron &&
        neuron.squash === fromNeuron.squash &&
        (neuron.squash === IDENTITY.NAME ||
          neuron.squash === LOGISTIC.NAME) &&
        inConn.fromUUID !== neuron.uuid &&
        outConn.toUUID !== neuron.uuid
      ) {
        // Correct bias accumulation using neuron.bias multiplied by outgoing weight
        const combinedWeight = inConn.weight * outConn.weight;
        assert(Number.isFinite(combinedWeight), "combinedWeight not finite");

        const combinedBias = neuron.bias + inConn.weight * fromNeuron.bias;
        assert(Number.isFinite(combinedBias), "combinedBias not finite");

        // Update toNeuron bias correctly to reflect chain accumulation
        neuron.bias = combinedBias;

        // Remove old synapses
        compactCreature.synapses = compactCreature.synapses.filter(
          (s) => s !== inConn && s !== outConn,
        );

        // Add new synapse directly connecting fromNeuron to toNeuron
        compactCreature.synapses.push({
          weight: combinedWeight,
          fromUUID: fromNeuron.uuid,
          toUUID: toNeuron.uuid,
        });

        // Remove neuron from neurons list
        compactCreature.neurons = compactCreature.neurons.filter((n) =>
          n.uuid !== neuron.uuid
        );
        neuronMap.delete(neuron.uuid);

        // Rebuild inward and outward maps after changes
        inwardConnections.clear();
        outwardConnections.clear();
        compactCreature.synapses.forEach((synapse) => {
          outwardConnections.set(
            synapse.fromUUID,
            (outwardConnections.get(synapse.fromUUID) || []).concat(synapse),
          );
          inwardConnections.set(
            synapse.toUUID,
            (inwardConnections.get(synapse.toUUID) || []).concat(synapse),
          );
        });

        didCompact = true;
        break; // restart the loop after each mutation
      }
    }
  }

  /** If not feedback loop, remove synapses that are going backwards */
  if (!feedbackLoop) {
    // Create a map of neuron UUIDs to their indices for quick lookup
    const neuronIndexMap = new Map<string, number>();
    compactCreature.neurons.forEach((neuron, index) => {
      neuronIndexMap.set(neuron.uuid, index);
    });

    // Create a set of synapses to remove
    const synapsesToRemove = new Set<SynapseExport>();

    // Check each synapse
    compactCreature.synapses.forEach((synapse) => {
      const fromIndex = neuronIndexMap.get(synapse.fromUUID);
      const toIndex = neuronIndexMap.get(synapse.toUUID);

      // If the source neuron appears later in the array than the target neuron
      if (
        fromIndex !== undefined && toIndex !== undefined &&
        fromIndex > toIndex
      ) {
        synapsesToRemove.add(synapse);
      }
    });

    // Remove the identified synapses
    compactCreature.synapses = compactCreature.synapses.filter(
      (synapse) => !synapsesToRemove.has(synapse),
    );
    if (synapsesToRemove.size > 0) {
      didCompact = true;
    }
  }

  /** clean up dangling neurons */
  let danglesFound: boolean;
  do {
    danglesFound = false;
    for (const neuron of compactCreature.neurons) {
      if (neuron.type === "hidden" || neuron.type === "constant") {
        const outConns = outwardConnections.get(neuron.uuid) || [];
        if (outConns.length === 0) {
          compactCreature.neurons = compactCreature.neurons.filter((n) =>
            n.uuid !== neuron.uuid
          );
          neuronMap.delete(neuron.uuid);
          compactCreature.synapses = compactCreature.synapses.filter((s) =>
            s.toUUID !== neuron.uuid
          );
          didCompact = true;
          break;
        }
      }
    }
  } while (danglesFound);

  if (didCompact) {
    addTag(compactCreature, "approach", "compact" as Approach);
    delete compactCreature.memetic;
    removeTag(compactCreature, "approach-logged");

    const oldNeurons = compactCreature.neurons.length -
      compactCreature.input - compactCreature.output;
    addTag(compactCreature, "old-neurons", oldNeurons.toString());
    Deno.writeTextFileSync(
      ".compacted-before.json",
      JSON.stringify(compactCreature, null, 1),
    );
    const c = Creature.fromJSON(compactCreature);
    try {
      c.validate();
    } catch (e) {
      console.error("Error validating compacted creature", e);
      Deno.writeTextFileSync(
        ".compacted-error.json",
        JSON.stringify(compactCreature, null, 1),
      );
      c.fix();
      c.validate();
      Deno.writeTextFileSync(
        ".compacted-fixed.json",
        JSON.stringify(c.exportJSON(), null, 1),
      );
    }

    return c;
  }

  return undefined;
}
