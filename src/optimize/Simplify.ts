import { addTag, removeTag } from "@stsoftware/tags";
import { type CreatureExport, CreatureUtil } from "../../mod.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { HYPOT } from "../methods/activations/aggregate/HYPOT.ts";
import { HYPOTv2 } from "../methods/activations/aggregate/HYPOTv2.ts";
import { IF } from "../methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "../methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "../methods/activations/aggregate/MINIMUM.ts";
import { ABSOLUTE } from "../methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { RELU } from "../methods/activations/types/RELU.ts";
import type { SimplifyBiasInterface } from "./SimplifyBiasInterface.ts";

export function simplify(creature: Creature): Creature | undefined {
  const complexUUID = CreatureUtil.makeUUID(creature);
  const exported = creature.exportJSON();
  const neuronsMap = new Map<string, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronsMap.set(neuron.uuid, neuron);
  });
  const synapseMap = new Map<string, Map<string, SynapseExport>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.fromUUID);
    if (!fromMap) {
      fromMap = new Map<string, SynapseExport>();
      synapseMap.set(synapse.fromUUID, fromMap);
    }
    fromMap.set(synapse.toUUID, synapse);
  });
  const dependantSquashes = new Map<string, Set<string>>();
  exported.neurons.forEach((neuron) => {
    let set = dependantSquashes.get(neuron.uuid);
    if (!set) {
      set = new Set<string>();
      dependantSquashes.set(neuron.uuid, set);
    }

    synapseMap.get(neuron.uuid)?.forEach((synapse) => {
      const fromNeuron = neuronsMap.get(synapse.toUUID);
      if (fromNeuron) {
        set.add(fromNeuron.squash ?? "NONE");
      }
    });
  });
  const identityUUIDs: string[] = [];
  exported.neurons.forEach((neuron) => {
    if (neuron.squash === IDENTITY.NAME && neuron.type === "hidden") {
      const dependants = dependantSquashes.get(neuron.uuid);

      if (dependants) {
        const aggregateSquash = Array.from(dependants).some((squash) => {
          return isAggregationSquash(squash);
        });
        if (!aggregateSquash) {
          identityUUIDs.push(neuron.uuid);
        }
      }
    }
  });
  let simplified = exported;
  if (identityUUIDs.length !== 0) {
    simplified = removeNeuron(
      exported,
      identityUUIDs[Math.floor(Math.random() * identityUUIDs.length)],
    );
  }

  simplified = removeKnownSign(simplified);

  simplified = simplifyConstants(simplified);

  simplified.neurons.forEach((neuron) => {
    if (neuron.squash) {
      const squash = Activations.find(neuron.squash);
      if (squash) {
        const squashedSimplified = (squash as unknown) as SimplifyBiasInterface;
        if (squashedSimplified.simplifyBias) {
          neuron.bias = squashedSimplified.simplifyBias(neuron.bias);
        }
      }
    }
  });

  try {
    const simplifiedCreature = Creature.fromJSON(simplified);
    const simplifiedUUID = CreatureUtil.makeUUID(simplifiedCreature);
    if (complexUUID === simplifiedUUID) {
      return undefined;
    }
    delete simplifiedCreature.memetic;

    return simplifiedCreature;
    // // ZZZZZ
  } catch (e) {
    console.error("Error tuning", e);

    Deno.writeTextFileSync(
      ".test/simplified.json",
      JSON.stringify(simplified, null, 2),
    );
    creature.DEBUG = false;
    Deno.writeTextFileSync(
      ".test/creature.json",
      JSON.stringify(creature.exportJSON(), null, 2),
    );
    throw e;
  }
}

export function removeKnownSign(exported: CreatureExport) {
  const neuronMap = new Map<string, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronMap.set(neuron.uuid, neuron);
  });
  const synapseMap = new Map<string, Map<string, number>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.toUUID);
    if (!fromMap) {
      fromMap = new Map<string, number>();
      synapseMap.set(synapse.toUUID, fromMap);
    }
    fromMap.set(synapse.fromUUID, synapse.weight);
  });
  for (let indx = 0; indx < exported.neurons.length; indx++) {
    const neuron = exported.neurons[indx];
    if (neuron.type == "hidden") {
      if (neuron.squash == ABSOLUTE.NAME || neuron.squash == RELU.NAME) {
        let allNonNegative = true;
        const fromMap = synapseMap.get(neuron.uuid);

        if (fromMap) {
          const UUIDs = [...fromMap.keys()];
          for (let indx = 0; indx < UUIDs.length; indx++) {
            const uuid = UUIDs[indx];
            const fromNeuron = neuronMap.get(uuid);
            if (!fromNeuron) {
              allNonNegative = false;
              break;
            } else {
              const squashName = neuronMap.get(uuid)?.squash;
              if (squashName) {
                const weight = fromMap.get(uuid)!;
                const squash = Activations.find(squashName);
                if (
                  (squash.range.low < 0 && weight >= 0) ||
                  (squash.range.high <= 0 && weight <= 0)
                ) {
                  allNonNegative = false;
                  break;
                }
              }
            }
          }

          if (allNonNegative) {
            return removeNeuron(exported, neuron.uuid);
          }
        }
      }
    }
  }

  return exported;
}

function isAggregationSquash(
  squash?: string,
): boolean {
  switch (squash) {
    case MAXIMUM.NAME:
    case MINIMUM.NAME:
    case HYPOT.NAME:
    case HYPOTv2.NAME:
    case IF.NAME:
      return true;
    default:
      return false;
  }
}

function simplifyConstants(exported: CreatureExport) {
  //ZZZZZ
  const cleanExported: CreatureExport = JSON.parse(JSON.stringify(exported));
  const neuronMap = new Map<string, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronMap.set(neuron.uuid, neuron);
  });
  const synapseFromMap = new Map<string, Map<string, number>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseFromMap.get(synapse.fromUUID);
    if (!fromMap) {
      fromMap = new Map<string, number>();
      synapseFromMap.set(synapse.fromUUID, fromMap);
    }
    fromMap.set(synapse.toUUID, synapse.weight);
  });
  const synapseToMap = new Map<string, Set<string>>();
  exported.synapses.forEach((synapse) => {
    let toSet = synapseToMap.get(synapse.toUUID);
    if (!toSet) {
      toSet = new Set<string>();
      synapseToMap.set(synapse.toUUID, toSet);
    }
    toSet.add(synapse.fromUUID);
  });

  for (let indx = 0; indx < exported.neurons.length; indx++) {
    const neuron = exported.neurons[indx];
    if (neuron.type == "constant") {
      const toMap = synapseFromMap.get(neuron.uuid);

      if (toMap) {
        const UUIDs = [...toMap.keys()];
        for (let indx = 0; indx < UUIDs.length; indx++) {
          const uuid = UUIDs[indx];

          const targetNeuron = neuronMap.get(uuid);

          if (targetNeuron) {
            if (!isAggregationSquash(targetNeuron.squash)) {
              const biasDelta = neuron.bias * toMap.get(uuid)!;
              targetNeuron.bias += biasDelta;
              toMap.delete(uuid)!;

              exported.synapses = exported.synapses.filter((synapse) =>
                synapse.fromUUID !== neuron.uuid || synapse.toUUID !== uuid
              );
              exported.neurons = exported.neurons.filter((neuron) =>
                neuron.type !== "constant" ||
                synapseFromMap.get(neuron.uuid)?.size !== 0
              );

              const fromSet = synapseToMap.get(targetNeuron.uuid);
              if (fromSet) {
                fromSet.delete(neuron.uuid);
                if (fromSet.size === 0 && targetNeuron.type === "hidden") {
                  if (!targetNeuron.squash) {
                    ///ZZZZ
                    Deno.writeTextFileSync(
                      ".test/simplifyConstants-clean.json",
                      JSON.stringify(cleanExported, null, 2),
                    );

                    Deno.writeTextFileSync(
                      "..test/simplifyConstants-error.json",
                      JSON.stringify(exported, null, 2),
                    );
                    throw new Error(`No squash for ${targetNeuron.uuid}`);
                  }
                  (targetNeuron as { type: string }).type = "constant";

                  const squash = Activations.find(
                    targetNeuron.squash!,
                  );
                  delete targetNeuron.squash;
                  const activation = squash as ActivationInterface;

                  const constantBias = activation.squash(targetNeuron.bias);
                  targetNeuron.bias = constantBias;
                }
              }
            }
          }
        }
      }
    }
  }

  return exported;
}

export function removeNeuron(
  exported: CreatureExport,
  identityUUID: string,
): CreatureExport {
  const simpliedExport: CreatureExport = JSON.parse(JSON.stringify(exported));
  const neuronMap = new Map<string, NeuronExport>();
  simpliedExport.neurons.forEach((neuron: NeuronExport) => {
    neuronMap.set(neuron.uuid, neuron);
  });

  const neuronToRemove = simpliedExport.neurons.find(
    (neuron: NeuronExport) => neuron.uuid === identityUUID,
  );
  if (!neuronToRemove) {
    throw new Error(`Neuron not found: ${identityUUID}`);
  }

  simpliedExport.neurons = simpliedExport.neurons.filter(
    (neuron: NeuronExport) => neuron.uuid !== identityUUID,
  );

  const newSynapses: SynapseExport[] = [];
  const adjustedBiases = new Set<string>();

  const synapseMap = new Map<string, Map<string, SynapseExport>>();
  simpliedExport.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.fromUUID);
    if (!fromMap) {
      fromMap = new Map<string, SynapseExport>();
      synapseMap.set(synapse.fromUUID, fromMap);
    }
    fromMap.set(synapse.toUUID, synapse);
  });

  simpliedExport.synapses.forEach((outerSynapse) => {
    if (outerSynapse.toUUID === identityUUID) {
      simpliedExport.synapses.forEach((innerSynapse) => {
        if (innerSynapse.fromUUID === identityUUID) {
          const adjustedWeight = outerSynapse.weight * innerSynapse.weight;

          const duplicate = synapseMap.get(outerSynapse.fromUUID)?.get(
            innerSynapse.toUUID,
          );

          if (!duplicate) {
            newSynapses.push({
              weight: adjustedWeight,
              fromUUID: outerSynapse.fromUUID,
              toUUID: innerSynapse.toUUID,
            });
          } else {
            duplicate.weight = adjustedWeight + duplicate.weight;
          }

          const targetNeuron = neuronMap.get(innerSynapse.toUUID);
          if (targetNeuron && !adjustedBiases.has(innerSynapse.toUUID)) {
            // Adjust bias using the weight sign
            const biasAdjustment = neuronToRemove.bias * innerSynapse.weight;
            const bias = targetNeuron!.bias + biasAdjustment;
            targetNeuron!.bias = bias;
            adjustedBiases.add(innerSynapse.toUUID);
          }
        }
      });
    }
  });

  simpliedExport.synapses = simpliedExport.synapses.filter(
    (synapse) =>
      synapse.toUUID !== identityUUID && synapse.fromUUID !== identityUUID,
  );

  simpliedExport.synapses = simpliedExport.synapses.concat(newSynapses);

  delete simpliedExport.memetic;
  addTag(simpliedExport, "approach", "simplified");

  removeTag(simpliedExport, "approach-logged");

  return simpliedExport;
}
