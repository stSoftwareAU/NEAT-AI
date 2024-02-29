import { Creature } from "../Creature.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { Synapse } from "../architecture/Synapse.ts";

export function createConstantOne(creature: Creature, count: number) {
  let uuid;
  switch (count) {
    case 1:
      uuid = "second-one";
      break;
    case 2:
      uuid = "third-one";
      break;
    default:
      uuid = "first-one";
  }
  let firstHiddenIndx = -1;
  let foundConstant;
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const n = creature.neurons[indx];
    if (firstHiddenIndx == -1) {
      if (n.type == "hidden") {
        firstHiddenIndx = n.index;
      }
    }
    if (n.uuid == uuid) {
      if (n.type !== "constant") {
        throw new Error(`Must be a constant was: ${n.type}`);
      }
      foundConstant = n;
      foundConstant.bias = 1;
      if (firstHiddenIndx === -1) {
        firstHiddenIndx = foundConstant.index;
      }

      break;
    }
  }

  const constantOne = new Neuron(
    uuid,
    "constant",
    1,
    creature,
    undefined,
  );
  constantOne.index = firstHiddenIndx;
  const left = creature.neurons.slice(0, firstHiddenIndx);
  const right = creature.neurons.slice(firstHiddenIndx);
  right.forEach((n) => {
    n.index++;
  });
  creature.neurons = [...left, constantOne, ...right];

  creature.synapses.forEach((c) => {
    if (c.from >= firstHiddenIndx) c.from++;
    if (c.to >= firstHiddenIndx) c.to++;
  });

  if (foundConstant) {
    let firstIndx = -1;
    for (let indx = creature.input; indx < creature.neurons.length; indx++) {
      const n = creature.neurons[indx];
      if (n.uuid == uuid) {
        if (firstIndx === -1) {
          firstIndx = n.index;
        } else {
          creature.synapses.forEach((c) => {
            if (c.from === n.index) {
              c.from = firstIndx;
            }
          });

          creature.clearCache();
          removeHiddenNode(creature, n.index);
          break;
        }
      }
    }
  }

  creature.clearCache();

  return constantOne;
}

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
    item.index--;
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
