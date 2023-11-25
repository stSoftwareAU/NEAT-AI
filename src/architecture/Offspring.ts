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

  static breadOld(network1: Network, network2: Network) {
    if (
      network1.input !== network2.input || network1.output !== network2.output
    ) {
      throw new Error("Networks don't have the same input/output size!");
    }

    // Initialize offspring
    const offspring = new Network(network1.input, network1.output, false);
    offspring.connections = [];
    offspring.nodes = [];

    // Determine offspring node size
    const max = Math.max(network1.nodes.length, network2.nodes.length);
    const min = Math.min(network1.nodes.length, network2.nodes.length);
    const size = Math.floor(Math.random() * (max - min + 1) + min);

    // Rename some variables for easier reading
    const uuidMap = new Map<string, number>();

    for (let i = network1.nodes.length; i--;) {
      const node = network1.nodes[i];
      if (node.index != i) {
        console.trace();
        throw "Not index correctly index: " + node.index + " at: " + i;
      }
      if (!node.uuid) {
        throw "Not index correctly index: " + node.index + " at: " + i;
      }
      uuidMap.set(node.uuid, node.index * -1);
    }

    for (let i = network2.nodes.length; i--;) {
      const node = network2.nodes[i];
      if (node.index != i) {
        console.trace();
        throw "Not index correctly index: " + node.index + " at: " + i;
      }
      if (!node.uuid) {
        throw "Not index correctly index: " + node.index + " at: " + i;
      }
      uuidMap.set(node.uuid, node.index * -1);
    }

    const connectionList: ConnectionInternal[] = [];
    let outputIndx = 0;
    // Assign nodes from parents to offspring
    for (let i = 0; i < size; i++) {
      // Determine if an output node is needed
      let node;
      if (i < size - network1.output) {
        const random = Math.random();
        node = random >= 0.5 ? network1.nodes[i] : network2.nodes[i];

        if (node === undefined || node.type === "output") {
          const other = random < 0.5 ? network1.nodes[i] : network2.nodes[i];

          if (other != undefined && other.type !== "output") {
            node = other;
          }
        }
      } else {
        if (Math.random() >= 0.5) {
          node = network1
            .nodes[network1.nodes.length - network1.output + outputIndx];
        } else {
          node = network2
            .nodes[network2.nodes.length - network2.output + outputIndx];
        }
        outputIndx++;
        if (node.type !== "output") {
          console.trace();
          throw i + ") expected 'output' was: " + node.type;
        }
      }

      let uuid = node.uuid;
      if (!uuid) {
        console.trace();
        throw "No UUID";
      }

      const currentPos = uuidMap.get(uuid);
      if (currentPos !== undefined && currentPos > 0) {
        if (uuid.startsWith("input-")) {
          console.trace();
          throw "Duplicate input: " + uuid;
        }
        uuid = crypto.randomUUID();
      }

      const newNode = new Node(
        uuid,
        node.type,
        node.bias,
        offspring,
        node.squash,
      );

      addTags(newNode, node);

      newNode.index = i;
      offspring.nodes.push(newNode);

      uuidMap.set(uuid, i);

      if (newNode.type !== "constant") {
        const tmpNetwork = (node as Node).network;
        tmpNetwork.toConnections(node.index ? node.index : 0).forEach((c) => {
          const fromUUID = tmpNetwork.nodes[c.from].uuid;
          if (!fromUUID) throw "No UUID";
          const from = uuidMap.get(fromUUID);
          if (from === undefined) throw "No index for UUID: " + fromUUID;

          if (from <= i) {
            let tmpFrom = from;
            if (tmpFrom < 0) {
              const tmpFrom2 = tmpFrom * -1;

              if (tmpFrom2 <= i) {
                if (offspring.nodes[tmpFrom2].type == "output") {
                  const tmpFrom3 = i - (c.to - c.from);
                  if (tmpFrom3 >= 0) {
                    tmpFrom = tmpFrom3;
                  } else {
                    let tmpFrom4 = tmpFrom2;
                    while (offspring.nodes[tmpFrom4].type == "output") {
                      tmpFrom4--;
                    }

                    tmpFrom = tmpFrom4;
                  }
                } else {
                  tmpFrom = tmpFrom2;
                }
              } else {
                const tmpFrom5 = i - (c.to - c.from);
                if (tmpFrom5 >= 0) {
                  tmpFrom = tmpFrom5;
                }
              }
            }

            if (tmpFrom < 0) {
              for (let attempts = 0; true; attempts++) {
                const tmpFrom6 = Math.floor((i + 1) * Math.random());
                if (offspring.nodes[tmpFrom6].type !== "output") {
                  tmpFrom = tmpFrom6;
                  break;
                }

                if (attempts > 12) {
                  throw "Can't make from: " + tmpFrom6;
                }
              }
            }

            connectionList.push({
              from: tmpFrom,
              to: i,
              weight: c.weight,
              type: c.type,
            });
          }
        });
      }
    }
    offspring.clearState();

    connectionList.forEach((c) => {
      if (offspring.getConnection(c.from, c.to) == null) {
        offspring.connect(
          c.from,
          c.to,
          c.weight,
          c.type,
        );
      }
    });

    offspring.fix();

    return offspring;
  }
}
