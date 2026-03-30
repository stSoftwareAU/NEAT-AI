import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";

export function editParentByIndex(
  parent: Creature,
  target: Creature,
): Creature {
  const parentExport = parent.exportJSON();
  const targetExport = target.exportJSON();

  const targetSet = new Set<string>();
  targetExport.neurons.forEach((n) => {
    if (typeof n.uuid === "string") {
      targetSet.add(n.uuid);
    }
  });

  let parentIndx = 0;

  const parentNeuronSet = new Set<string>();
  parentExport.neurons.forEach((n) => {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      parentNeuronSet.add(n.uuid);
    }
  });

  for (let index = 0; index < targetExport.neurons.length; index++) {
    const targetNeuron = targetExport.neurons[index];
    if (targetNeuron.type === "hidden") {
      const targetUuid = targetNeuron.uuid;
      if (
        typeof targetUuid === "string" && !parentNeuronSet.has(targetUuid)
      ) {
        while (parentIndx < parentExport.neurons.length) {
          const parentNeuron = parentExport.neurons[parentIndx];
          parentIndx++;
          if (
            parentNeuron.type === "hidden" &&
            typeof parentNeuron.uuid === "string" &&
            !targetSet.has(parentNeuron.uuid)
          ) {
            targetNeuron.uuid = parentNeuron.uuid;
            targetSet.add(parentNeuron.uuid);
            addTag(targetNeuron, "alias", targetUuid);
            addTag(targetNeuron, "approach", "graft");
            targetExport.synapses.forEach((synapse) => {
              if (synapse.fromUUID === targetUuid) {
                synapse.fromUUID = parentNeuron.uuid;
              }
              if (synapse.toUUID === targetUuid) {
                synapse.toUUID = parentNeuron.uuid;
              }
            });
            break;
          }
        }
      }
    }
  }

  const child = Creature.fromJSON(targetExport);
  try {
    child.validate();
  } catch (error) {
    if (error instanceof ValidationError) {
      if (error.reason === "MEMETIC") {
        delete child.memetic;
        child.fix();
        child.validate();
        return child;
      }
    }
    throw error;
  }
  return child;
}
