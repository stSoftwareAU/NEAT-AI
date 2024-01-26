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
        const connections = mother.toConnections(node.index);
        connectionsMap.set(node.uuid, cloneConnections(mother, connections));
      }
    }

    for (const node of father.neurons) {
      if (node.type !== "input") {
        if (nodeMap.has(node.uuid) == false || Math.random() >= 0.5) {
          nodeMap.set(node.uuid, node);
          const connections = mother.toConnections(node.index);
          connectionsMap.set(node.uuid, cloneConnections(father, connections));
        }
      }
    }

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
        const fromNeuron = indxMap.get(c.fromUUID);
        const toNode = indxMap.get(c.toUUID);

        if (fromNeuron != null && toNode != null) {
          if (fromNeuron <= toNode) {
            offspring.connect(fromNeuron, toNode, c.weight, c.type);
          }
        } else {
          throw new Error("Could not find nodes for connection");
        }
      });
    });

    offspring.clearState();
    offspring.fix();
    offspring.validate();

    return offspring;
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
        } else {
          lastIndx += 0.000_000_1;
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
