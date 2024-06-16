import { addTags } from "@stsoftware/tags";
import { Creature } from "../Creature.ts";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";
import { Neuron } from "./Neuron.ts";
import { creatureValidate } from "./CreatureValidate.ts";
import { assert } from "@std/assert";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport } from "./NeuronInterfaces.ts";

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
  static async breed(mum: Creature, dad: Creature) {
    const mother = Creature.fromJSON(mum.exportJSON());
    await CreatureUtil.makeUUID(mother);
    assert(mother.uuid);
    const father = Creature.fromJSON(dad.exportJSON());
    await CreatureUtil.makeUUID(father);
    assert(father.uuid);
    if (
      mother.input !== father.input || mother.output !== father.output
    ) {
      throw new Error(
        `Parents aren't the same species (inputs ${mother.input} != ${father.input} or outputs ${mother.output} != ${father.output})`,
      );
    }

    // Initialize offspring
    const offspring = new Creature(mother.input, mother.output, {
      lazyInitialization: true,
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
      if (node != null) {
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
      console.warn(e.message);
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

    const child = await Offspring.handleGeneticIsolation(
      offspring,
      mother,
      father,
    );

    try {
      creatureValidate(child);

      return child;
    } catch (e) {
      switch (e.name) {
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "NO_INWARD_CONNECTIONS":
        case "IF_CONDITIONS":
          child.fix();
          creatureValidate(child);
          return child;
        default:
          console.info(e);
          offspring.DEBUG = false;
          Deno.writeTextFileSync(
            ".offspring-mother.json",
            JSON.stringify(mother.exportJSON(), null, 2),
          );
          Deno.writeTextFileSync(
            ".offspring-child.json",
            JSON.stringify(child.exportJSON(), null, 2),
          );
          Deno.writeTextFileSync(
            ".offspring-father.json",
            JSON.stringify(father.exportJSON(), null, 2),
          );

          throw e;
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
      if (neuron.type == "input") childMap.set(neuron.uuid, indx);
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
      if (a.type == "output") {
        if (b.type != "output") {
          return 1;
        }
        return Number.parseInt(a.uuid.substring(7)) -
          Number.parseInt(b.uuid.substring(7));
      } else if (b.type == "output") {
        return -1;
      }
      // if (a.index == b.index) {
      if (a.uuid == b.uuid) {
        throw new Error(`Duplicate uuid ${a.uuid}`);
      }
      let indxA = firstMap.get(a.uuid);
      if (indxA == undefined) {
        indxA = secondMap.get(a.uuid);
        if (indxA == undefined) throw new Error(`Can't find ${a.uuid}`);
        indxA += 0.1;
      }

      let indxB = firstMap.get(b.uuid);
      if (indxB == undefined) {
        indxB = secondMap.get(b.uuid);
        if (indxB == undefined) throw new Error(`Can't find ${b.uuid}`);
        indxB += 0.1;
      }

      if (indxA == indxB) throw new Error(`Duplicate index ${indxA}`);

      return indxA - indxB;
    });

    const usedIndx = new Set<number>();
    let missing = true;
    for (let attempts = 0; missing && attempts < child.length; attempts++) {
      missing = false;
      child.forEach((neuron) => {
        if (neuron.type != "input" && neuron.type != "output") {
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
                  if (dependantIndx == undefined) {
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
      if (a.type == "output") {
        if (b.type != "output") {
          return 1;
        }
        const aIndx = Number.parseInt(a.uuid.substring(7));
        const bIndx = Number.parseInt(b.uuid.substring(7));

        return aIndx - bIndx;
      } else if (b.type == "output") {
        return -1;
      } else if (a.type == "input" && b.type == "input") {
        return a.index - b.index;
      } else {
        const aIndx = childMap.get(a.uuid);
        if (aIndx == undefined) throw new Error(`Can't find ${a.uuid}`);
        const bIndx = childMap.get(b.uuid);
        if (bIndx == undefined) throw new Error(`Can't find ${b.uuid}`);

        /*
         * Sort by index in child array, if not input or output.
         * This will ensure that the order of the nodes is the same as the order of the nodes in the mother and father networks.
         * This is important for the crossover function to work correctly.
         */
        return aIndx - bIndx;
      }
    });
  }

  public static async handleGeneticIsolation(
    child: Creature,
    mother: Creature,
    father: Creature,
  ): Promise<Creature> {
    assert(mother.uuid);
    assert(father.uuid);

    const childUUID = await CreatureUtil.makeUUID(child);

    // Check if the offspring is a clone
    if (childUUID !== mother.uuid && childUUID !== father.uuid) return child;

    const cloneOfParent = child.uuid === mother.uuid ? father : mother;
    const otherParent = child.uuid === mother.uuid ? mother : father;

    const childExport = child.exportJSON();

    const childNeuronMap = new Map<string, NeuronExport>();
    const childConnectionsMap = new Map<string, SynapseExport[]>();
    cloneOfParent.neurons.filter((neuron) => neuron.type !== "input").forEach(
      (neuron) => {
        childNeuronMap.set(neuron.uuid, neuron.exportJSON());
        const connections = cloneOfParent.inwardConnections(neuron.index);
        childConnectionsMap.set(
          neuron.uuid,
          Offspring.cloneConnections(cloneOfParent, connections),
        );
      },
    );

    const otherNeuronMap = new Map<string, NeuronExport>();
    const otherConnectionsMap = new Map<string, SynapseExport[]>();
    otherParent.neurons.filter((neuron) => neuron.type !== "input").forEach(
      (neuron) => {
        otherNeuronMap.set(neuron.uuid, neuron.exportJSON());
        const connections = otherParent.inwardConnections(neuron.index);
        otherConnectionsMap.set(
          neuron.uuid,
          Offspring.cloneConnections(otherParent, connections),
        );
      },
    );

    /**
     * Find an insertion point for a missing neuron.
     * Insert the missing neuron before the mutated child's target insertion point neuron.
     */
    let insertionNeuron: NeuronExport | undefined;
    for (const neuron of otherParent.neurons) {
      const connections = otherParent.outwardConnections(neuron.index);
      for (const connection of connections) {
        const toUUID = otherParent.neurons[connection.to].uuid;
        if (childNeuronMap.has(toUUID)) {
          insertionNeuron = neuron.exportJSON();
          break;
        }
      }
      if (insertionNeuron) {
        break;
      }
    }
    if (!insertionNeuron) {
      throw new Error("No suitable neuron found for insertion");
    }

    // Find the index to insert the neuron in the child
    const targetNeuronIndex = childExport.neurons.findIndex((neuron) =>
      neuron.uuid === insertionNeuron.uuid
    );
    if (targetNeuronIndex === -1) {
      throw new Error("No target neuron found for insertion");
    }

    /**
     * Calculate the existing absolute weight of the synapses that are connected to the target insertion point neuron.
     */
    const targetNeuronUUID = childExport.neurons[targetNeuronIndex].uuid;
    const targetNeuronConnections = childExport.synapses.filter(
      (synapse) => synapse.toUUID === targetNeuronUUID,
    );
    const totalWeight = targetNeuronConnections.reduce(
      (sum, synapse) => sum + Math.abs(synapse.weight),
      0,
    );

    /**
     * Add a new synapse to link the inserted neuron to the target insertion point neuron.
     */
    const newSynapse: SynapseExport = {
      fromUUID: insertionNeuron.uuid,
      toUUID: targetNeuronUUID,
      weight: Math.random() - 0.5, // Random weight between -0.5 and 0.5
    };
    childExport.synapses.push(newSynapse);

    /**
     * Scale the weights of the synapses that are connected to the target insertion point neuron to maintain the same total weight.
     */
    targetNeuronConnections.forEach((synapse) => {
      synapse.weight = (synapse.weight / totalWeight) *
        (totalWeight - Math.abs(newSynapse.weight));
    });

    // Add the neuron to the child
    childExport.neurons.splice(targetNeuronIndex, 0, insertionNeuron);

    /**
     * Recursively add missing neurons and synapses to the mutated child required by the newly inserted neuron.
     */
    function addMissingNeuronsAndSynapses(neuronUUID: string) {
      const connections = otherConnectionsMap.get(neuronUUID);
      if (!connections) return;

      connections.forEach((connection) => {
        if (!childNeuronMap.has(connection.fromUUID)) {
          const missingNeuron = otherNeuronMap.get(connection.fromUUID);
          if (missingNeuron) {
            childExport.neurons.push(missingNeuron);
            addMissingNeuronsAndSynapses(missingNeuron.uuid);
          }
        }
        if (
          !childExport.synapses.some((synapse) =>
            synapse.fromUUID === connection.fromUUID &&
            synapse.toUUID === connection.toUUID
          )
        ) {
          childExport.synapses.push(connection);
        }
      });
    }

    addMissingNeuronsAndSynapses(insertionNeuron.uuid);

    /**
     * Import the mutated child JSON to create a "real" creature and recalculate the UUID.
     */
    const mutatedChild = Creature.fromJSON(childExport);
    assert(!mutatedChild.uuid);
    await CreatureUtil.makeUUID(mutatedChild);

    return mutatedChild;
  }
}
