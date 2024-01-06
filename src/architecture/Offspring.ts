import { addTags } from "../tags/TagsInterface.ts";
import {
  ConnectionExport,
  ConnectionInternal,
} from "./ConnectionInterfaces.ts";
import { Network } from "./Network.ts";
import { Node } from "./Node.ts";

export class Offspring {
  /**
   * Create an offspring from two parent networks
   */
  static bread(mother: Network, father: Network) {
    if (
      mother.input !== father.input || mother.output !== father.output
    ) {
      throw new Error("Parents don't have the same input/output size!");
    }

    // Initialize offspring
    const offspring = new Network(mother.input, mother.output, {
      lazyInitialization: true,
    });
    offspring.connections = [];
    offspring.nodes = [];

    const nodeMap = new Map<string, Node>();
    const connectionsMap = new Map<string, ConnectionExport[]>();
    function cloneConnections(
      creature: Network,
      connections: ConnectionInternal[],
    ): ConnectionExport[] {
      const tmpConnections: ConnectionExport[] = [];

      connections.forEach((connection) => {
        const c: ConnectionExport = {
          fromUUID: creature.nodes[connection.from].uuid,
          toUUID: creature.nodes[connection.to].uuid,
          weight: connection.weight,
          type: connection.type,
        };
        tmpConnections.push(c);
      });

      return tmpConnections;
    }

    for (const node of mother.nodes) {
      if (node.type !== "input") {
        nodeMap.set(node.uuid, node);
        const connections = mother.toConnections(node.index);
        connectionsMap.set(node.uuid, cloneConnections(mother, connections));
      }
    }

    for (const node of father.nodes) {
      if (node.type !== "input") {
        if (nodeMap.has(node.uuid) == false || Math.random() >= 0.5) {
          nodeMap.set(node.uuid, node);
          const connections = mother.toConnections(node.index);
          connectionsMap.set(node.uuid, cloneConnections(father, connections));
        }
      }
    }

    const tmpNodes: Node[] = [];
    const tmpUUIDs = new Set<string>();
    function cloneNode(node: Node) {
      if (!tmpUUIDs.has(node.uuid)) {
        tmpUUIDs.add(node.uuid);
        tmpNodes.push(node);
        const connections = connectionsMap.get(node.uuid);
        connections?.forEach((connection) => {
          const fromNode = nodeMap.get(connection.fromUUID);
          if (fromNode && fromNode?.type !== "input") {
            cloneNode(fromNode);
          }
        });
      }
    }

    for (let indx = 0; indx < mother.input; indx++) {
      tmpNodes.push(mother.nodes[indx]);
    }

    for (let indx = mother.output; indx--;) {
      const node = nodeMap.get(`output-${indx}`);
      if (node != null) {
        cloneNode(node);
      }
    }

    Offspring.sortNodes(tmpNodes, mother.nodes, father.nodes);

    offspring.nodes.length = tmpNodes.length;
    const indxMap = new Map<string, number>();
    tmpNodes.forEach((node, indx) => {
      const newNode = new Node(
        node.uuid,
        node.type,
        node.bias,
        offspring,
        node.squash,
      );

      addTags(newNode, node);

      newNode.index = indx;
      offspring.nodes[indx] = newNode;
      indxMap.set(node.uuid, indx);
    });

    offspring.nodes.forEach((node) => {
      const connections = connectionsMap.get(node.uuid);

      connections?.forEach((c) => {
        const fromNode = indxMap.get(c.fromUUID);
        const toNode = indxMap.get(c.toUUID);

        if (fromNode != null && toNode != null) {
          if (fromNode <= toNode) {
            offspring.connect(fromNode, toNode, c.weight, c.type);
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

  static sortNodes(child: Node[], mother: Node[], father: Node[]) {
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
    child.sort((a: Node, b: Node) => {
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
    child.sort((a: Node, b: Node) => {
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
