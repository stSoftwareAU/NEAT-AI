import { assert } from "@std/assert";
import { addTags, getTag, removeTag } from "@stsoftware/tags/mod";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";
import { editParentByIndex } from "../breed/EditParentByIndex.ts";
import { geneticCompatibility } from "../breed/GeneticCompatibility.ts";
import { Creature } from "../Creature.ts";
import { upgrade } from "../upgrade/Upgrade.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { creatureValidate } from "./CreatureValidate.ts";
import { Neuron } from "./Neuron.ts";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";

class OffspringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffspringError";
  }
}

export class Offspring {
  /**
   * Create an offspring from two parent networks
   */
  static breed(
    mum: Creature,
    dad: Creature,
    options: {
      geneticCompatibilityThreshold?: number;
      forwardOnly?: boolean;
    } = {},
  ): Creature | undefined {
    const mother = upgrade(Creature.fromJSON(mum.exportJSON()));
    CreatureUtil.makeUUID(mother);
    let father = upgrade(Creature.fromJSON(dad.exportJSON()));
    CreatureUtil.makeUUID(father);
    assert(
      mother.input === father.input && mother.output === father.output,
      "Parents aren't the same species",
    );

    const compatibility = geneticCompatibility(mother, father);
    let fixAliases = false;
    if (
      options.geneticCompatibilityThreshold &&
      compatibility < options.geneticCompatibilityThreshold
    ) {
      father = editParentByIndex(mother, father);
      CreatureUtil.makeUUID(father);

      fixAliases = true;
    }

    // Initialize offspring
    const offspring = new Creature(mother.input, mother.output, {
      lazyInitialization: true,
      semanticVersion: mother.semanticVersion,
    });
    offspring.synapses = [];
    offspring.neurons = [];

    const neuronMap = new Map<string, Neuron>();
    const connectionsMap = new Map<string, SynapseExport[]>();

    // Populate neuronMap and connectionsMap with neurons and synapses from both parents
    for (const node of mother.neurons) {
      if (node.type !== "input") {
        neuronMap.set(node.uuid, node);
        const connections = mother.inwardConnections(node.index);
        Offspring.fixType(node, connections);
        connectionsMap.set(
          node.uuid,
          Offspring.cloneConnections(mother, connections),
        );
      }
    }

    for (const node of father.neurons) {
      if (node.type !== "input") {
        if (Math.random() >= 0.5) {
          const connections = father.inwardConnections(node.index);

          Offspring.fixType(node, connections);
          const tmpConnections = Offspring.cloneConnections(
            father,
            connections,
          );

          neuronMap.set(node.uuid, node);
          connectionsMap.set(node.uuid, tmpConnections);
        }
      }
    }

    // Ensure all neurons are in neuronMap
    let addedMissing;
    do {
      addedMissing = false;
      for (const uuid of neuronMap.keys()) {
        const connections = connectionsMap.get(uuid);
        if (connections) {
          for (const connection of connections) {
            let fromNeuron = neuronMap.get(connection.fromUUID);
            if (!fromNeuron) {
              const motherNeuron = mother.neurons.find((neuron) =>
                neuron.uuid === connection.fromUUID
              );
              fromNeuron = motherNeuron;
              let parent = mother;
              if (!fromNeuron || Math.random() >= 0.5) {
                const fatherNeuron = father.neurons.find((neuron) =>
                  neuron.uuid === connection.fromUUID
                );
                if (fatherNeuron) {
                  fromNeuron = fatherNeuron;
                  parent = father;
                }
              }
              if (!fromNeuron) {
                throw new Error(`Can't find ${connection.fromUUID}`);
              }

              neuronMap.set(fromNeuron.uuid, fromNeuron);
              const parentConnections = parent.inwardConnections(
                fromNeuron.index,
              );
              connectionsMap.set(
                fromNeuron.uuid,
                Offspring.cloneConnections(parent, parentConnections),
              );
              addedMissing = true;
            }
          }
        } else {
          throw new Error(`Can't find connections for ${uuid}`);
        }
      }
    } while (addedMissing);

    // Function to clone nodes and create the offspring network
    const tmpNodes: Neuron[] = [];
    const tmpUUIDs = new Set<string>();

    function cloneNode(neuron: Neuron) {
      if (!tmpUUIDs.has(neuron.uuid)) {
        const connections = connectionsMap.get(neuron.uuid);
        if (!connections) {
          throw new Error(`Can't find connections for ${neuron.uuid}`);
        }
        tmpUUIDs.add(neuron.uuid);
        connections.forEach((connection) => {
          const fromNeuron = neuronMap.get(connection.fromUUID);
          if (!fromNeuron) {
            throw new Error(`Can't find ${connection.fromUUID}`);
          } else if (fromNeuron.type !== "input") {
            cloneNode(fromNeuron);
          }
        });
        tmpNodes.push(neuron);
      }
    }

    // Add input neurons
    for (let indx = 0; indx < mother.input; indx++) {
      const input = mother.neurons[indx];
      tmpNodes.push(input);
      tmpUUIDs.add(input.uuid);
    }

    // Add output neurons
    for (let indx = mother.output; indx--;) {
      const node = neuronMap.get(`output-${indx}`);
      if (node !== undefined) {
        cloneNode(node);
      } else {
        throw new Error(`Can't find output-${indx}`);
      }
    }

    try {
      Offspring.sortNeurons(
        tmpNodes,
        mother.neurons,
        father.neurons,
        connectionsMap,
      );
    } catch (e) {
      if (e instanceof OffspringError) {
        return undefined;
      }
      throw e;
    }

    offspring.neurons.length = tmpNodes.length;
    const indxMap = new Map<string, number>();
    tmpNodes.forEach((neuron, indx) => {
      const newNode = new Neuron(
        neuron.uuid,
        neuron.type,
        neuron.bias,
        offspring,
        neuron.squash,
      );

      addTags(newNode, neuron);

      newNode.index = indx;
      offspring.neurons[indx] = newNode;
      indxMap.set(neuron.uuid, indx);
    });

    // Connect synapses, reweighing as necessary
    offspring.neurons.forEach((neuron) => {
      if (neuron.type !== "input") {
        const connections = connectionsMap.get(neuron.uuid);
        if (!connections) {
          throw new Error(`Can't find connections for ${neuron.uuid}`);
        }
        connections.forEach((c) => {
          const fromIndx = indxMap.get(c.fromUUID);
          const toIndx = indxMap.get(c.toUUID);

          if (fromIndx !== undefined && toIndx !== undefined) {
            if (fromIndx <= toIndx) {
              const toType = offspring.neurons[toIndx].type;
              if (toType === "hidden" || toType === "output") {
                if (!offspring.getSynapse(fromIndx, toIndx)) {
                  const babySynapse = offspring.connect(
                    fromIndx,
                    toIndx,
                    c.weight,
                    c.type,
                  );

                  addTags(babySynapse, c);
                }
              } else {
                throw new Error(
                  `Can't connect to ${toType} neuron at indx=${toIndx} of type ${toType}!`,
                );
              }
            } else {
              throw new Error(
                `${neuron.ID()} fromIndx=${fromIndx} > toIndx=${toIndx}`,
              );
            }
          }
        });
      }
    });

    offspring.clearState();

    delete offspring.uuid;
    const childUUID = CreatureUtil.makeUUID(offspring);

    assert(childUUID, "Failed to make UUID for offspring");
    assert(mother.uuid, "Failed to make UUID for mother");
    assert(father.uuid, "Failed to make UUID for father");
    /* No point returning clones */
    if (childUUID === mother.uuid || childUUID === father.uuid) {
      return undefined;
    }

    if (fixAliases) {
      const fixed = offspring.exportJSON();
      for (let i = 0; i < fixed.neurons.length; i++) {
        const n = fixed.neurons[i];
        const alias = getTag(n, "alias");
        if (alias) {
          removeTag(n, "alias");
          const oldUUID = n.uuid;
          (n as { uuid: string }).uuid = alias;
          fixed.synapses.forEach((s) => {
            if (s.fromUUID === oldUUID) s.fromUUID = alias;
            if (s.toUUID === oldUUID) s.toUUID = alias;
          });
        }
      }

      offspring.loadFrom(fixed, false);
    }

    if (mother.memetic) {
      const memetic = memeticUpdate(mother, offspring);
      offspring.memetic = memetic;
    } else if (father.memetic) {
      const memetic = memeticUpdate(father, offspring);
      offspring.memetic = memetic;
    }

    const shouldBeForwardOnly = options.forwardOnly === true ||
      mum.forwardOnly === true || dad.forwardOnly === true;

    try {
      creatureValidate(offspring);

      if (shouldBeForwardOnly) {
        offspring.forwardOnly = true;
        try {
          offspring.validate({ forwardOnly: true });
        } catch (e) {
          const error = e as Error;
          if (
            error.name === "SELF_CONNECTION" ||
            error.name === "RECURSIVE_SYNAPSE"
          ) {
            offspring.fix({ forwardOnly: true });
          } else {
            throw e;
          }
        }
      }

      return offspring;
    } catch (e) {
      const error = e as Error;
      const errorName = error.name ? error.name : "ERROR";
      switch (errorName) {
        case "RECURSIVE_CONNECTION":
          return undefined;
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "NO_INWARD_CONNECTIONS":
        case "IF_CONDITIONS":
          offspring.fix();
          creatureValidate(offspring);
          return offspring;
        case "MEMETIC":
          delete offspring.memetic;
          offspring.validate();
          return offspring;
        default:
          console.error(e);
          offspring.DEBUG = false;
          Deno.writeTextFileSync(
            ".offspring-mother.json",
            JSON.stringify(mother.exportJSON(), null, 1),
          );
          Deno.writeTextFileSync(
            ".offspring-offspring.json",
            JSON.stringify(offspring.exportJSON(), null, 1),
          );
          Deno.writeTextFileSync(
            ".offspring-father.json",
            JSON.stringify(father.exportJSON(), null, 1),
          );

          throw e;
      }
    }
  }

  private static fixType(node: Neuron, connections: SynapseInternal[]) {
    if (node.type === "constant") {
      if (connections.length > 0) {
        node.type = "hidden";
      }
    } else if (node.type === "hidden") {
      if (connections.length === 0) {
        node.type = "constant";
      }
    }
  }

  public static cloneConnections(
    creature: Creature,
    connections: SynapseInternal[],
  ): SynapseExport[] {
    const tmpConnections: SynapseExport[] = [];

    connections.forEach((connection) => {
      const c: SynapseExport = {
        fromUUID: creature.neurons[connection.from].uuid,
        toUUID: creature.neurons[connection.to].uuid,
        weight: connection.weight,
        type: connection.type,
        tags: connection.tags,
      };
      tmpConnections.push(c);
    });

    return tmpConnections;
  }

  public static sortNeurons(
    child: Neuron[],
    mother: Neuron[],
    father: Neuron[],
    connectionsMap: Map<string, SynapseExport[]>,
  ) {
    const childMap = new Map<string, number>();

    mother.forEach((neuron, indx) => {
      if (neuron.type === "input") childMap.set(neuron.uuid, indx);
    });

    const mumMap = new Map<string, number>();
    const dadMap = new Map<string, number>();

    mother.forEach((node, indx) => {
      mumMap.set(node.uuid, indx);
    });

    father.forEach((node, indx) => {
      dadMap.set(node.uuid, indx);
    });

    let firstMap = mumMap;
    let secondMap = dadMap;
    if (mumMap.size < dadMap.size) {
      firstMap = dadMap;
      secondMap = mumMap;
    }

    /* Sort output to the end and input to the beginning */
    child.sort((a: Neuron, b: Neuron) => {
      if (a.type === "output") {
        if (b.type !== "output") {
          return 1;
        }
        return Number.parseInt(a.uuid.substring(7)) -
          Number.parseInt(b.uuid.substring(7));
      } else if (b.type === "output") {
        return -1;
      }

      if (a.uuid === b.uuid) {
        throw new Error(`Duplicate uuid ${a.uuid}`);
      }
      let indxA = firstMap.get(a.uuid);
      if (indxA === undefined) {
        indxA = secondMap.get(a.uuid);
        if (indxA === undefined) throw new Error(`Can't find ${a.uuid}`);
        indxA += 0.1;
      }

      let indxB = firstMap.get(b.uuid);
      if (indxB === undefined) {
        indxB = secondMap.get(b.uuid);
        if (indxB === undefined) throw new Error(`Can't find ${b.uuid}`);
        indxB += 0.1;
      }

      if (indxA === indxB) throw new Error(`Duplicate index ${indxA}`);

      return indxA - indxB;
    });

    const usedIndx = new Set<number>();
    let missing = true;
    for (let attempts = 0; missing && attempts < child.length; attempts++) {
      missing = false;
      child.forEach((neuron) => {
        if (neuron.type !== "input" && neuron.type !== "output") {
          const uuid = neuron.uuid;

          if (!childMap.has(uuid)) {
            const firstIndx = firstMap.get(uuid);
            const secondIndx = secondMap.get(uuid);

            let indx = 0;
            if (firstIndx !== undefined) {
              indx = firstIndx;
            } else if (secondIndx !== undefined) {
              indx = secondIndx;
            } else {
              throw new Error(
                `Can't find ${uuid} in father or mother creatures!`,
              );
            }
            connectionsMap.get(uuid)?.forEach((connection) => {
              if (indx >= 0) {
                const fromUUID = connection.fromUUID;
                if (!fromUUID.startsWith("input-")) {
                  const dependantIndx = childMap.get(fromUUID);
                  if (dependantIndx === undefined) {
                    indx = -1;
                  } else if (dependantIndx >= indx) {
                    indx = dependantIndx + 1;
                  }
                }
              }
            });
            if (indx >= 0) {
              if (usedIndx.has(indx)) {
                childMap.forEach((childIndx, uuid) => {
                  if (childIndx >= indx) {
                    usedIndx.delete(childIndx);
                    childIndx++;
                    usedIndx.add(childIndx);
                  }
                  childMap.set(uuid, childIndx);
                });
              }
              usedIndx.add(indx);
              childMap.set(uuid, indx);
            } else {
              missing = true;
            }
          }
        }
      });
    }

    if (missing) {
      throw new OffspringError("Can't find a solution to sort the nodes!");
    }

    /** Second sort should only change the order of new nodes. */
    child.sort((a: Neuron, b: Neuron) => {
      if (a.type === "output") {
        if (b.type !== "output") {
          return 1;
        }
        const aIndx = Number.parseInt(a.uuid.substring(7));
        const bIndx = Number.parseInt(b.uuid.substring(7));

        return aIndx - bIndx;
      } else if (b.type === "output") {
        return -1;
      } else if (a.type === "input" && b.type === "input") {
        return a.index - b.index;
      } else {
        const aIndx = childMap.get(a.uuid);
        if (aIndx === undefined) throw new Error(`Can't find ${a.uuid}`);
        const bIndx = childMap.get(b.uuid);
        if (bIndx === undefined) throw new Error(`Can't find ${b.uuid}`);

        /*
         * Sort by index in child array, if not input or output.
         * This will ensure that the order of the nodes is the same as the order of the nodes in the mother and father networks.
         * This is important for the crossover function to work correctly.
         */
        return aIndx - bIndx;
      }
    });
  }
}
