import { addTags } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";
import { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";
import { Neuron } from "./Neuron.ts";

export class Offspring {
  /**
   * Create an offspring from two parent networks
   */
  static bread(mother: Creature, father: Creature) {
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

    const nodeMap = new Map<string, Neuron>();
    const connectionsMap = new Map<string, SynapseExport[]>();
    function cloneConnections(
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

    for (const node of mother.neurons) {
      if (node.type !== "input") {
        nodeMap.set(node.uuid, node);
        const connections = mother.inwardConnections(node.index);
        connectionsMap.set(node.uuid, cloneConnections(mother, connections));
      }
    }

    for (const node of father.neurons) {
      if (node.type !== "input") {
        if (Math.random() >= 0.5) {
          const connections = father.inwardConnections(node.index);
          const tmpConnections = cloneConnections(father, connections);

          nodeMap.set(node.uuid, node);
          connectionsMap.set(node.uuid, tmpConnections);
        }
      }
    }

    let addedMissing;
    do {
      addedMissing = false;
      for (const key of nodeMap.keys()) {
        const connections = connectionsMap.get(key);
        if (connections) {
          for (const connection of connections) {
            let fromNeuron = nodeMap.get(connection.fromUUID);
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

              nodeMap.set(fromNeuron.uuid, fromNeuron);
              const connections = parent.inwardConnections(fromNeuron.index);
              connectionsMap.set(
                fromNeuron.uuid,
                cloneConnections(parent, connections),
              );
              addedMissing = true;
            }
          }
        }
      }
    } while (addedMissing);

    const tmpNodes: Neuron[] = [];
    const tmpUUIDs = new Set<string>();
    function cloneNode(node: Neuron) {
      if (!tmpUUIDs.has(node.uuid)) {
        tmpUUIDs.add(node.uuid);
        tmpNodes.push(node);
        const connections = connectionsMap.get(node.uuid);
        connections?.forEach((connection) => {
          const fromNeuron = nodeMap.get(connection.fromUUID);
          if (fromNeuron && fromNeuron?.type !== "input") {
            cloneNode(fromNeuron);
          }
        });
      }
    }

    for (let indx = 0; indx < mother.input; indx++) {
      tmpNodes.push(mother.neurons[indx]);
    }

    for (let indx = mother.output; indx--;) {
      const node = nodeMap.get(`output-${indx}`);
      if (node != null) {
        cloneNode(node);
      }
    }

    Offspring.sortNodes(tmpNodes, mother.neurons, father.neurons);

    offspring.neurons.length = tmpNodes.length;
    const indxMap = new Map<string, number>();
    tmpNodes.forEach((node, indx) => {
      const newNode = new Neuron(
        node.uuid,
        node.type,
        node.bias,
        offspring,
        node.squash,
      );

      addTags(newNode, node);

      newNode.index = indx;
      offspring.neurons[indx] = newNode;
      indxMap.set(node.uuid, indx);
    });

    offspring.neurons.forEach((node) => {
      const connections = connectionsMap.get(node.uuid);
      connections?.forEach((c) => {
        const fromIndx = indxMap.get(c.fromUUID);
        const toIndx = indxMap.get(c.toUUID);

        if (fromIndx != null && toIndx != null) {
          if (fromIndx <= toIndx) {
            const toType = offspring.neurons[toIndx].type;
            if (toType == "hidden" || toType == "output") {
              offspring.connect(fromIndx, toIndx, c.weight, c.type);
            }
          }
        } else {
          throw new Error("Could not find nodes for connection");
        }
      });
    });

    offspring.clearState();
    // offspring.fix();
    try {
      offspring.validate();

      return offspring;
    } catch (e) {
      switch (e.name) {
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "IF_CONDITIONS":
          offspring.fix();
          offspring.validate();
          return offspring;
        default:
          console.info(e);
          offspring.DEBUG = false;
          Deno.writeTextFileSync(
            ".offspring.json",
            JSON.stringify(offspring.exportJSON(), null, 2),
          );
          // return offspring;
          return undefined;
          // throw e;
      }
    }
  }

  static sortNodes(child: Neuron[], mother: Neuron[], father: Neuron[]) {
    const childMap = new Map<string, number>();
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
      return a.index - b.index;
    });

    let lastIndx = 0;
    child.forEach((node) => {
      if (node.type != "input" && node.type != "output") {
        const motherIndx = motherMap.get(node.uuid);
        const fatherIndx = fatherMap.get(node.uuid);

        if (motherIndx && fatherIndx) {
          lastIndx = Math.max(motherIndx, fatherIndx);
        } else if (motherIndx) {
          lastIndx += 0.1;
        } else {
          lastIndx += 0.2;
        }
        childMap.set(node.uuid, lastIndx);
      }
    });

    /** Second sort should only change the order of new nodes. */
    child.sort((a: Neuron, b: Neuron) => {
      if (a.type == "output") {
        if (b.type != "output") {
          return 1;
        }
        return Number.parseInt(a.uuid.substring(7)) -
          Number.parseInt(b.uuid.substring(7));
      } else if (b.type == "output") {
        return -1;
      } else if (a.type == "input" || b.type == "input") {
        return a.index - b.index;
      } else {
        const aIndx = childMap.get(a.uuid);
        const bIndx = childMap.get(b.uuid);
        /*
         * Sort by index in child array, if not input or output.
         * This will ensure that the order of the nodes is the same as the order of the nodes in the mother and father networks.
         * This is important for the crossover function to work correctly.
         */
        return (aIndx ? aIndx : 0) - (bIndx ? bIndx : 0);
      }
    });
  }
}
