import { addTag, removeTag } from "@stsoftware/tags/mod";
import { type CreatureExport, CreatureUtil } from "../../mod.ts";
import { normaliseComputationalNeuronOrderInExport } from "../architecture/NormaliseComputationalNeuronOrder.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { Creature } from "../Creature.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { isAggregationSquash } from "../methods/activations/SquashUtils.ts";
import { validateOrDiagnose } from "../utils/Diagnostics.ts";
import { ABSOLUTE } from "../methods/activations/types/ABSOLUTE.ts";
import { COMPLEMENT } from "../methods/activations/types/COMPLEMENT.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { ReLU } from "../methods/activations/types/ReLU.ts";
import { hasSimplifyBias } from "../methods/activations/TypeGuards.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

export function simplify(creature: Creature): Creature | undefined {
  const complexUUID = CreatureUtil.makeUUID(creature);
  let exported = creature.exportJSON();
  normaliseCreatureExport(exported);

  exported = simplifyComplementToIdentity(exported);
  const neuronsMap = new Map<number, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronsMap.set(neuron.id!, neuron);
  });
  const synapseMap = new Map<number, Map<number, SynapseExport>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.fromId!);
    if (!fromMap) {
      fromMap = new Map<number, SynapseExport>();
      synapseMap.set(synapse.fromId!, fromMap);
    }
    fromMap.set(synapse.toId!, synapse);
  });
  const dependantSquashes = new Map<number, Set<string>>();
  exported.neurons.forEach((neuron) => {
    let set = dependantSquashes.get(neuron.id!);
    if (!set) {
      set = new Set<string>();
      dependantSquashes.set(neuron.id!, set);
    }

    synapseMap.get(neuron.id!)?.forEach((synapse) => {
      const fromNeuron = neuronsMap.get(synapse.toId!);
      if (fromNeuron) {
        set.add(fromNeuron.squash ?? "NONE");
      }
    });
  });
  const identityIds: number[] = [];
  exported.neurons.forEach((neuron) => {
    if (neuron.squash === IDENTITY.NAME && neuron.type === "hidden") {
      const dependants = dependantSquashes.get(neuron.id!);

      if (dependants) {
        const aggregateSquash = Array.from(dependants).some((squash) => {
          return isAggregationSquash(squash);
        });
        if (!aggregateSquash) {
          identityIds.push(neuron.id!);
        }
      }
    }
  });
  let simplified = exported;
  if (identityIds.length !== 0) {
    simplified = removeNeuron(
      exported,
      identityIds[
        Math.floor(getRandomNumberGenerator().random() * identityIds.length)
      ],
    );
  }

  simplified = removeKnownSign(simplified);

  simplified = simplifyConstants(simplified);

  simplified.neurons.forEach((neuron) => {
    if (neuron.squash) {
      const squash = Activations.find(neuron.squash);
      if (squash && hasSimplifyBias(squash)) {
        neuron.bias = squash.simplifyBias(neuron.bias);
      }
    }
  });

  const simplifiedCreature = Creature.fromJSON(simplified);
  const simplifiedUUID = CreatureUtil.makeUUID(simplifiedCreature);
  if (complexUUID === simplifiedUUID) {
    return undefined;
  }

  validateOrDiagnose(
    simplifiedCreature,
    "simplify",
    creature.forwardOnly ? { forwardOnly: true } : undefined,
  );

  delete simplifiedCreature.memetic;

  return simplifiedCreature;
}

function simplifyComplementToIdentity(
  exported: CreatureExport,
): CreatureExport {
  // 29-Dec-2025: COMPLEMENT (1 - x) is a simple affine transform, so it can be
  // represented exactly as IDENTITY by negating inbound weights and adjusting
  // bias: 1 - (Σ(wi * ai) + b) = Σ((-wi) * ai) + (1 - b).
  for (const neuron of exported.neurons) {
    if (neuron.squash !== COMPLEMENT.NAME) continue;

    neuron.squash = IDENTITY.NAME;
    neuron.bias = 1 - neuron.bias;

    for (const synapse of exported.synapses) {
      if (synapse.toId === neuron.id) {
        synapse.weight = -synapse.weight;
      }
    }
  }

  return exported;
}

export function removeKnownSign(exported: CreatureExport) {
  normaliseCreatureExport(exported);
  const neuronMap = new Map<number, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronMap.set(neuron.id!, neuron);
  });
  const synapseMap = new Map<number, Map<number, number>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.toId!);
    if (!fromMap) {
      fromMap = new Map<number, number>();
      synapseMap.set(synapse.toId!, fromMap);
    }
    fromMap.set(synapse.fromId!, synapse.weight);
  });
  for (const neuron of exported.neurons) {
    if (neuron.type === "hidden") {
      if (neuron.squash === ABSOLUTE.NAME || neuron.squash === ReLU.NAME) {
        let allNonNegative = true;
        const fromMap = synapseMap.get(neuron.id!);

        if (fromMap) {
          const UUIDs = [...fromMap.keys()];
          for (const uuid of UUIDs) {
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
            return removeNeuron(exported, neuron.id!);
          }
        }
      }
    }
  }

  return exported;
}

function simplifyConstants(exported: CreatureExport) {
  const neuronMap = new Map<number, NeuronExport>();
  exported.neurons.forEach((neuron) => {
    neuronMap.set(neuron.id!, neuron);
  });
  const synapseFromMap = new Map<number, Map<number, number>>();
  exported.synapses.forEach((synapse) => {
    let fromMap = synapseFromMap.get(synapse.fromId!);
    if (!fromMap) {
      fromMap = new Map<number, number>();
      synapseFromMap.set(synapse.fromId!, fromMap);
    }
    fromMap.set(synapse.toId!, synapse.weight);
  });
  const synapseToMap = new Map<number, Set<number>>();
  exported.synapses.forEach((synapse) => {
    let toSet = synapseToMap.get(synapse.toId!);
    if (!toSet) {
      toSet = new Set<number>();
      synapseToMap.set(synapse.toId!, toSet);
    }
    toSet.add(synapse.fromId!);
  });

  for (const neuron of exported.neurons) {
    if (neuron.type === "constant") {
      const toMap = synapseFromMap.get(neuron.id!);

      if (toMap) {
        const UUIDs = [...toMap.keys()];
        for (const uuid of UUIDs) {
          const targetNeuron = neuronMap.get(uuid);

          if (targetNeuron) {
            if (!isAggregationSquash(targetNeuron.squash)) {
              const biasDelta = neuron.bias * toMap.get(uuid)!;
              targetNeuron.bias += biasDelta;
              toMap.delete(uuid)!;

              exported.synapses = exported.synapses.filter((synapse) =>
                synapse.fromId !== neuron.id! || synapse.toId! !== uuid
              );
              exported.neurons = exported.neurons.filter((neuron) =>
                neuron.type !== "constant" ||
                synapseFromMap.get(neuron.id!)?.size !== 0
              );

              const fromSet = synapseToMap.get(targetNeuron.id!);
              if (fromSet) {
                fromSet.delete(neuron.id!);
                if (fromSet.size === 0 && targetNeuron.type === "hidden") {
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

  normaliseComputationalNeuronOrderInExport(exported);
  return exported;
}

export function removeNeuron(
  exported: CreatureExport,
  identityId: number,
): CreatureExport {
  normaliseCreatureExport(exported);
  const simplifiedExport: CreatureExport = JSON.parse(JSON.stringify(exported));
  const neuronMap = new Map<number, NeuronExport>();
  simplifiedExport.neurons.forEach((neuron: NeuronExport) => {
    neuronMap.set(neuron.id!, neuron);
  });

  const neuronToRemove = simplifiedExport.neurons.find(
    (neuron: NeuronExport) => neuron.id === identityId,
  );
  if (!neuronToRemove) {
    throw new TopologyError(
      `Neuron not found: ${identityId}`,
      "MISSING_NEURON",
    );
  }

  simplifiedExport.neurons = simplifiedExport.neurons.filter(
    (neuron: NeuronExport) => neuron.id !== identityId,
  );

  const newSynapses: SynapseExport[] = [];
  const adjustedBiases = new Set<number>();

  const synapseMap = new Map<number, Map<number, SynapseExport>>();
  simplifiedExport.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.fromId!);
    if (!fromMap) {
      fromMap = new Map<number, SynapseExport>();
      synapseMap.set(synapse.fromId!, fromMap);
    }
    fromMap.set(synapse.toId!, synapse);
  });

  // Issue #2090: Build id→uuid lookup so new bypass synapses carry UUIDs.
  const idToUuid = new Map<number, string>();
  for (const neuron of simplifiedExport.neurons) {
    if (neuron.id !== undefined && neuron.uuid) {
      idToUuid.set(neuron.id, neuron.uuid);
    }
  }
  for (let i = 0; i < exported.input; i++) {
    idToUuid.set(i, `input-${i}`);
  }

  simplifiedExport.synapses.forEach((outerSynapse) => {
    if (outerSynapse.toId === identityId) {
      simplifiedExport.synapses.forEach((innerSynapse) => {
        if (innerSynapse.fromId === identityId) {
          const adjustedWeight = outerSynapse.weight * innerSynapse.weight;

          const duplicate = synapseMap.get(outerSynapse.fromId!)?.get(
            innerSynapse.toId!,
          );

          if (!duplicate) {
            newSynapses.push({
              weight: adjustedWeight,
              fromId: outerSynapse.fromId!,
              fromUUID: outerSynapse.fromUUID ??
                idToUuid.get(outerSynapse.fromId!),
              toId: innerSynapse.toId!,
              toUUID: innerSynapse.toUUID ??
                idToUuid.get(innerSynapse.toId!),
            });
          } else {
            duplicate.weight = adjustedWeight + duplicate.weight;
          }

          const targetNeuron = neuronMap.get(innerSynapse.toId!);
          if (targetNeuron && !adjustedBiases.has(innerSynapse.toId!)) {
            // Adjust bias using the weight sign
            const biasAdjustment = neuronToRemove.bias * innerSynapse.weight;
            const bias = targetNeuron!.bias + biasAdjustment;
            targetNeuron!.bias = bias;
            adjustedBiases.add(innerSynapse.toId!);
          }
        }
      });
    }
  });

  simplifiedExport.synapses = simplifiedExport.synapses.filter(
    (synapse) => synapse.toId !== identityId && synapse.fromId !== identityId,
  );

  simplifiedExport.synapses = simplifiedExport.synapses.concat(newSynapses);

  delete simplifiedExport.memetic;
  addTag(simplifiedExport, "approach", "simplified");

  removeTag(simplifiedExport, "approach-logged");

  return simplifiedExport;
}
