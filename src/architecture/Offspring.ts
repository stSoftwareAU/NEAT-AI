import { addTags } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";
import { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";
import { Neuron } from "./Neuron.ts";

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
  static bread(mum: Creature, dad: Creature) {
    const mother = Creature.fromJSON(mum.exportJSON());
    const father = Creature.fromJSON(dad.exportJSON());
    if (
      mother.input !== father.input || mother.output !== father.output
    ) {
      throw new Error("Parents don't have the same input/output size!");
    }

    // Initialize offspring
    const offspring = new Creature(mother.input, mother.output, {
      lazyInitialization: true,
    });
    offspring.synapses = [];
    offspring.neurons = [];

    const neuronMap = new Map<string, Neuron>();
    const connectionsMap = new Map<string, SynapseExport[]>();

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

    let addedMissing;
    do {
      addedMissing = false;
      for (const uuid of neuronMap.keys()) {
        const connections = connectionsMap.get(uuid);
        if (connections) {
          for (const connection of connections) {
            let fromNeuron = neuronMap.get(connection.fromUUID);
            if (!fromNeuron) {
              const motherNeuron = mother.neurons.find((neuron) => {
                return neuron.uuid == connection.fromUUID;
              });
              fromNeuron = motherNeuron;
              let parent = mother;
              if (!fromNeuron || Math.random() >= 0.5) {
                const fatherNeuron = father.neurons.find((neuron) => {
                  return neuron.uuid == connection.fromUUID;
                });
                if (fatherNeuron) {
                  fromNeuron = fatherNeuron;
                  parent = father;
                }
              }
              if (!fromNeuron) {
                throw new Error(`Can't find ${connection.fromUUID}`);
              }

              neuronMap.set(fromNeuron.uuid, fromNeuron);
              const connections = parent.inwardConnections(fromNeuron.index);
              connectionsMap.set(
                fromNeuron.uuid,
                Offspring.cloneConnections(parent, connections),
              );
              addedMissing = true;
            }
          }
        } else {
          throw new Error(`Can't find connections for ${uuid}`);
        }
      }
    } while (addedMissing);

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

    for (let indx = 0; indx < mother.input; indx++) {
      const input = mother.neurons[indx];
      tmpNodes.push(input);
      tmpUUIDs.add(input.uuid);
    }

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
              if (toType == "hidden" || toType == "output") {
                if (!offspring.getSynapse(fromIndx, toIndx)) {
                  offspring.connect(fromIndx, toIndx, c.weight, c.type);
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

    try {
      offspring.validate();

      return offspring;
    } catch (e) {
      switch (e.name) {
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "NO_INWARD_CONNECTIONS":
        case "IF_CONDITIONS":
          offspring.fix();
          offspring.validate();
          return offspring;
        default:
          console.info(e);
          offspring.DEBUG = false;
          Deno.writeTextFileSync(
            ".offspring-mother.json",
            JSON.stringify(mother.exportJSON(), null, 2),
          );
          Deno.writeTextFileSync(
            ".offspring-child.json",
            JSON.stringify(offspring.exportJSON(), null, 2),
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

    const motherMap = new Map<string, number>();
    const fatherMap = new Map<string, number>();

    mother.forEach((node, indx) => {
      motherMap.set(node.uuid, indx);
    });

    father.forEach((node, indx) => {
      fatherMap.set(node.uuid, indx);
    });

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
      if (a.index == b.index) {
        if (a.uuid == b.uuid) {
          throw new Error(`Duplicate uuid ${a.uuid}`);
        }
        const mumIndxA = motherMap.get(a.uuid);
        if (mumIndxA == undefined) {
          return -1;
        }
        const dadIndxA = fatherMap.get(a.uuid);
        if (dadIndxA == undefined) {
          return 1;
        }
        const mumIndxB = motherMap.get(b.uuid);
        if (mumIndxB == undefined) {
          return -1;
        }

        const dadIndxB = fatherMap.get(b.uuid);
        if (dadIndxB == undefined) {
          return 1;
        }

        return mumIndxA - mumIndxB;
      }
      return a.index - b.index;
    });
    const usedIndx = new Set<number>();
    let missing = true;
    for (let attempts = 0; missing && attempts < child.length; attempts++) {
      missing = false;
      child.forEach((neuron) => {
        if (neuron.type != "input" && neuron.type != "output") {
          const uuid = neuron.uuid;

          if (!childMap.has(uuid)) {
            const motherIndx = motherMap.get(uuid);
            const fatherIndx = fatherMap.get(uuid);

            let indx = 0;
            if (motherIndx !== undefined) {
              indx = motherIndx;
            } else if (fatherIndx !== undefined) {
              indx = fatherIndx;
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
}
