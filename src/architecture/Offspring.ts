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
    const offspring = new Network(mother.input, mother.output, false);
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

    tmpNodes.sort((a: Node, b: Node) => {
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
          console.trace();
          throw "Could not find nodes for connection";
        }
      });
    });

    offspring.clearState();
    offspring.fix();

    return offspring;
  }
}
