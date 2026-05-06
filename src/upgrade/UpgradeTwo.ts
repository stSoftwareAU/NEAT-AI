import { assert } from "@std/assert";
import { Creature, type SynapseExport } from "../../mod.ts";
import { getLogger } from "@utils/Logger.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { nextNeuronId } from "@architecture/NeuronId.ts";
import { exportJSONWithRuntimeIdsUnchecked } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { SQRT } from "@methods/activations/types/SQRT.ts";
import { SQUARE } from "@methods/activations/types/SQUARE.ts";

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

function buildIdToUuid(json: CreatureExport): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < json.input; i++) {
    map.set(i, `input-${i}`);
  }
  for (const neuron of json.neurons) {
    if (neuron.id !== undefined && neuron.uuid) {
      map.set(neuron.id, neuron.uuid);
    }
  }
  return map;
}

function removeHYPOT(json: CreatureExport) {
  const neurons = json.neurons;
  const synapses = json.synapses;
  let changed = false;
  const neuronsLength = neurons.length;
  const synapsesLength = synapses.length;
  const idToUuid = buildIdToUuid(json);
  for (let i = 0; i < neuronsLength; i++) {
    const neuron = neurons[i];
    if (neuron.squash === "HYPOT") {
      getLogger().info("Replacing HYPOT neuron", neuron.id);
      changed = true;
      for (let j = 0; j < synapsesLength; j++) {
        const synapse = synapses[j];
        if (synapse.toId === neuron.id) {
          const newUuid = crypto.randomUUID();
          const newNeuron: NeuronExport = {
            type: "hidden",
            id: nextNeuronId(),
            uuid: newUuid,
            squash: SQUARE.NAME,
            bias: 0,
          };
          idToUuid.set(newNeuron.id!, newUuid);

          neurons.splice(i, 0, newNeuron);
          synapse.toId = newNeuron.id;
          synapse.toUUID = newUuid;
          const newSynapse: SynapseExport = {
            fromId: newNeuron.id,
            fromUUID: newUuid,
            toId: neuron.id,
            toUUID: idToUuid.get(neuron.id!),
            weight: 1,
          };
          synapses.push(newSynapse);
        }
      }

      const identityUuid = crypto.randomUUID();
      const identityNeuron: NeuronExport = {
        type: "hidden",
        id: nextNeuronId(),
        uuid: identityUuid,
        squash: IDENTITY.NAME,
        bias: neuron.bias,
        tags: [
          {
            name: "upgrade",
            value: "2.0.0",
          },
        ],
      };
      idToUuid.set(identityNeuron.id!, identityUuid);
      neurons.splice(i + 1, 0, identityNeuron);
      neuron.squash = SQRT.NAME;
      neuron.bias = 0;
      for (let j = 0; j < synapses.length; j++) {
        const synapse = synapses[j];
        if (synapse.fromId === neuron.id) {
          synapse.fromId = identityNeuron.id;
          synapse.fromUUID = identityUuid;
        }
      }

      const identitySynapse: SynapseExport = {
        fromId: neuron.id,
        fromUUID: idToUuid.get(neuron.id!),
        toId: identityNeuron.id,
        toUUID: identityUuid,
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

  // Issue #2514: legacy upgrade JSON may carry residual recurrent edges
  // before `fix()` runs. Opt out of the load-side throw so the upgrader
  // can complete its repair pass.
  const tempCreature = Creature.fromJSON(json, false, "upgrade:removeHYPOT", {
    throwOnRecurrent: "never",
  });
  try {
    tempCreature.validate();
  } catch (e) {
    getLogger().info("Creature is not valid", e);
    tempCreature.fix();
  }
  // Issue #2546: legacy upgrade may have stripped recurrent edges via the
  // `throwOnRecurrent: "never"` load above; the unchecked export keeps the
  // upgrader from re-tripping on a creature that is already in mid-repair.
  return exportJSONWithRuntimeIdsUnchecked(tempCreature);
}

function removeHYPOTv2(json: CreatureExport) {
  const neurons = json.neurons;
  const synapses = json.synapses;
  let changed = false;
  const neuronsLength = neurons.length;
  const synapsesLength = synapses.length;
  const idToUuid = buildIdToUuid(json);
  for (let i = 0; i < neuronsLength; i++) {
    const neuron = neurons[i];
    if (neuron.squash === "HYPOTv2") {
      getLogger().info("Replacing HYPOTv2 neuron", neuron.id);
      changed = true;
      for (let j = 0; j < synapsesLength; j++) {
        const synapse = synapses[j];
        if (synapse.toId === neuron.id) {
          const newUuid = crypto.randomUUID();
          const newNeuron: NeuronExport = {
            type: "hidden",
            id: nextNeuronId(),
            uuid: newUuid,
            squash: SQUARE.NAME,
            bias: neuron.bias,
          };
          idToUuid.set(newNeuron.id!, newUuid);

          neurons.splice(i, 0, newNeuron);
          synapse.toId = newNeuron.id;
          synapse.toUUID = newUuid;
          const newSynapse: SynapseExport = {
            fromId: newNeuron.id,
            fromUUID: newUuid,
            toId: neuron.id,
            toUUID: idToUuid.get(neuron.id!),
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

  // Issue #2514: legacy upgrade JSON may carry residual recurrent edges
  // before `fix()` runs. Opt out of the load-side throw so the upgrader
  // can complete its repair pass.
  const tempCreature = Creature.fromJSON(json, false, "upgrade:removeHYPOTv2", {
    throwOnRecurrent: "never",
  });
  try {
    tempCreature.validate();
  } catch (e) {
    getLogger().info("Creature is not valid", e);
    delete tempCreature.memetic;
    tempCreature.fix();
  }

  // Issue #2546: legacy upgrade may have stripped recurrent edges via the
  // `throwOnRecurrent: "never"` load above; the unchecked export keeps the
  // upgrader from re-tripping on a creature that is already in mid-repair.
  return exportJSONWithRuntimeIdsUnchecked(tempCreature);
}
