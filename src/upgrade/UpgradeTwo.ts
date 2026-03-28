import { assert } from "@std/assert";
import { Creature, type SynapseExport } from "../../mod.ts";
import { getLogger } from "../utils/Logger.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { nextNeuronId } from "../architecture/NeuronId.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { SQRT } from "../methods/activations/types/SQRT.ts";
import { SQUARE } from "../methods/activations/types/SQUARE.ts";

/**
 * Upgrades a creature from version 1.x to version 2.0.0.
 * This function handles the migration of deprecated activation functions
 * and ensures compatibility with the new version.
 *
 * @param json - The creature data to upgrade (either internal or export format)
 * @returns The upgraded creature data with semantic version 2.0.0
 * @throws {Error} When the creature is already at version 2.x or higher
 */
export function upgradeTwo(
  json: CreatureInternal | CreatureExport,
): CreatureInternal | CreatureExport {
  assert(
    json.semanticVersion && json.semanticVersion.startsWith("1."),
    `Already upgraded ${json.semanticVersion}`,
  );

  if ("index" in json.neurons[0]) {
    return json as CreatureInternal;
  }
  const exported = json as CreatureExport;
  normaliseCreatureExport(exported);

  const updated = removeHYPOT(exported);
  const updated2 = removeHYPOTv2(updated);

  // CreatureExport
  return {
    ...updated2 as CreatureExport,
    semanticVersion: "2.0.0",
  } as CreatureExport;
}

function removeHYPOT(json: CreatureExport) {
  const neurons = json.neurons;
  const synapses = json.synapses;
  let changed = false;
  const neuronsLength = neurons.length;
  const synapsesLength = synapses.length;
  for (let i = 0; i < neuronsLength; i++) {
    const neuron = neurons[i];
    if (neuron.squash === "HYPOT") {
      getLogger().info("Replacing HYPOT neuron", neuron.id);
      changed = true;
      for (let j = 0; j < synapsesLength; j++) {
        const synapse = synapses[j];
        if (synapse.toId === neuron.id) {
          const newNeuron: NeuronExport = {
            type: "hidden",
            id: nextNeuronId(),
            squash: SQUARE.NAME,
            bias: 0,
          };

          neurons.splice(i, 0, newNeuron);
          synapse.toId = newNeuron.id;
          const newSynapse: SynapseExport = {
            fromId: newNeuron.id,
            toId: neuron.id,
            weight: 1,
          };
          synapses.push(newSynapse);
        }
      }

      const identityNeuron: NeuronExport = {
        type: "hidden",
        id: nextNeuronId(),
        squash: IDENTITY.NAME,
        bias: neuron.bias,
        tags: [
          {
            name: "upgrade",
            value: "2.0.0",
          },
        ],
      };
      neurons.splice(i + 1, 0, identityNeuron);
      neuron.squash = SQRT.NAME;
      neuron.bias = 0;
      for (let j = 0; j < synapses.length; j++) {
        const synapse = synapses[j];
        if (synapse.fromId === neuron.id) {
          synapse.fromId = identityNeuron.id;
        }
      }

      const identitySynapse: SynapseExport = {
        fromId: neuron.id,
        toId: identityNeuron.id,
        weight: 1,
      };
      synapses.push(identitySynapse);

      break;
    }
  }

  if (changed) {
    delete json.memetic;
    return removeHYPOT(json);
  }

  const tempCreature = Creature.fromJSON(json);
  try {
    tempCreature.validate();
  } catch (e) {
    getLogger().info("Creature is not valid", e);
    tempCreature.fix();
  }
  const exported = tempCreature.exportJSON();
  normaliseCreatureExport(exported);
  return exported;
}

function removeHYPOTv2(json: CreatureExport) {
  const neurons = json.neurons;
  const synapses = json.synapses;
  let changed = false;
  const neuronsLength = neurons.length;
  const synapsesLength = synapses.length;
  for (let i = 0; i < neuronsLength; i++) {
    const neuron = neurons[i];
    if (neuron.squash === "HYPOTv2") {
      getLogger().info("Replacing HYPOTv2 neuron", neuron.id);
      changed = true;
      for (let j = 0; j < synapsesLength; j++) {
        const synapse = synapses[j];
        if (synapse.toId === neuron.id) {
          const newNeuron: NeuronExport = {
            type: "hidden",
            id: nextNeuronId(),
            squash: SQUARE.NAME,
            bias: neuron.bias,
          };

          neurons.splice(i, 0, newNeuron);
          synapse.toId = newNeuron.id;
          const newSynapse: SynapseExport = {
            fromId: newNeuron.id,
            toId: neuron.id,
            weight: 1,
          };
          synapses.push(newSynapse);
        }
      }

      neuron.squash = SQRT.NAME;
      neuron.bias = 0;

      break;
    }
  }

  if (changed) {
    delete json.memetic;
    return removeHYPOTv2(json);
  }

  const tempCreature = Creature.fromJSON(json);
  try {
    tempCreature.validate();
  } catch (e) {
    getLogger().info("Creature is not valid", e);
    delete tempCreature.memetic;
    tempCreature.fix();
  }

  const exported = tempCreature.exportJSON();
  normaliseCreatureExport(exported);
  return exported;
}
