import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import { ValidationError } from "../errors/ValidationError.ts";

export function editParentByIndex(
  parent: Creature,
  target: Creature,
): Creature {
  const parentExport = parent.exportJSON();
  const targetExport = target.exportJSON();

  const targetSet = new Set<number>();
  targetExport.neurons.forEach((n) => targetSet.add(n.id));

  let parentIndx = 0;

  const parentNeuronSet = new Set<number>();
  parent.neurons.forEach((n) => parentNeuronSet.add(n.id));

  for (let index = 0; index < targetExport.neurons.length; index++) {
    const targetNeuron = targetExport.neurons[index];
    if (targetNeuron.type === "hidden") {
      if (!parentNeuronSet.has(targetNeuron.id)) {
        const currentId = targetNeuron.id;
        while (parentIndx < parentExport.neurons.length) {
          const parentNeuron = parentExport.neurons[parentIndx];
          parentIndx++;
          if (
            parentNeuron.type === "hidden" && !targetSet.has(parentNeuron.id)
          ) {
            (targetNeuron as { id: number }).id = parentNeuron.id;
            targetSet.add(parentNeuron.id);
            addTag(targetNeuron, "alias", String(currentId));
            addTag(targetNeuron, "approach", "graft");
            targetExport.synapses.forEach((synapse) => {
              if (synapse.fromId === currentId) {
                synapse.fromId = parentNeuron.id;
              }
              if (synapse.toId === currentId) {
                synapse.toId = parentNeuron.id;
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
