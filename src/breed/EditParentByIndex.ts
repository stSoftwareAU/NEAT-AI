import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";

export function editParentByIndex(
  parent: Creature,
  target: Creature,
): Creature {
  const parentExport = parent.exportJSON();
  const targetExport = target.exportJSON();

  const targetSet = new Set<string>();
  targetExport.neurons.forEach((n) => targetSet.add(n.uuid));

  let parentIndx = 0;

  const parentNeuronSet = new Set<string>();
  parent.neurons.forEach((n) => parentNeuronSet.add(n.uuid));

  for (let index = 0; index < targetExport.neurons.length; index++) {
    const targetNeuron = targetExport.neurons[index];
    if (targetNeuron.type === "hidden") {
      if (!parentNeuronSet.has(targetNeuron.uuid)) {
        const currentUUID = targetNeuron.uuid;
        while (parentIndx < parentExport.neurons.length) {
          const parentNeuron = parentExport.neurons[parentIndx];
          parentIndx++;
          if (
            parentNeuron.type === "hidden" && !targetSet.has(parentNeuron.uuid)
          ) {
            (targetNeuron as { uuid: string }).uuid = parentNeuron.uuid;
            targetSet.add(parentNeuron.uuid);
            addTag(targetNeuron, "alias", currentUUID);
            addTag(targetNeuron, "approach", "graft");
            targetExport.synapses.forEach((synapse) => {
              if (synapse.fromUUID === currentUUID) {
                synapse.fromUUID = parentNeuron.uuid;
              }
              if (synapse.toUUID === currentUUID) {
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
  child.validate();
  return child;
}
