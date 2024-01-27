import { Creature } from "../Creature.ts";
import { Synapse } from "../architecture/Synapse.ts";

/**
 *  Removes a node from the creature
 */
export function removeHiddenNode(creature: Creature, indx: number) {
  if (Number.isInteger(indx) == false || indx < 0) {
    throw new Error("Must be a positive integer was: " + indx);
  }

  const node = creature.neurons[indx];

  if (node.type !== "hidden" && node.type !== "constant") {
    throw new Error(
      `${indx}) Node must be a 'hidden' type was: ${node.type}`,
    );
  }
  const left = creature.neurons.slice(0, indx);
  const right = creature.neurons.slice(indx + 1);
  right.forEach((item) => {
    const node = item;
    node.index--;
  });

  const full = [...left, ...right];

  creature.neurons = full;

  const tmpConnections: Synapse[] = [];

  creature.synapses.forEach((c) => {
    if (c.from !== indx) {
      if (c.from > indx) c.from--;
      if (c.to !== indx) {
        if (c.to > indx) c.to--;

        tmpConnections.push(c);
      }
    }
  });

  creature.synapses = tmpConnections;
  creature.clearCache();
}
