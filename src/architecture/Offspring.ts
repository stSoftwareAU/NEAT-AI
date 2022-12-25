import { addTags, getTag } from "../tags/TagsInterface.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { Network } from "./Network.ts";
import { Node } from "./Node.ts";

export class Offspring {
  /**
   * Create an offspring from two parent networks
   */
  static bread(network1: Network, network2: Network) {
    if (
      network1.input !== network2.input || network1.output !== network2.output
    ) {
      throw new Error("Networks don't have the same input/output size!");
    }

    let tmpScore1 = network1.score;
    if (!tmpScore1) {
      const previousScoreTxt = getTag(network1, "score");
      if (previousScoreTxt) {
        tmpScore1 = parseFloat(previousScoreTxt);
      }
    }

    const score1 = tmpScore1 ? tmpScore1 : -1;

    let tmpScore2 = network2.score;
    if (!tmpScore2) {
      const previousScoreTxt = getTag(network2, "score");
      if (previousScoreTxt) {
        tmpScore2 = parseFloat(previousScoreTxt);
      }
    }

    const score2 = tmpScore2 ? tmpScore2 : -1;

    // Initialize offspring
    const offspring = new Network(network1.input, network1.output, false);
    offspring.connections = [];
    offspring.nodes = [];

    let size;

    if (network1.nodes.length == network2.nodes.length) {
      size = network1.nodes.length;
    } else {
      if (score1 > score2) {
        size = network1.nodes.length;
      } else if (score2 > score1) {
        size = network2.nodes.length;
      } else {
        // Determine offspring node size
        const max = Math.max(network1.nodes.length, network2.nodes.length);
        const min = Math.min(network1.nodes.length, network2.nodes.length);
        size = Math.floor(Math.random() * (max - min + 1) + min);
      }
    }

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

    const connectionList: ConnectionInterface[] = [];
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

          if (other.type === "output") {
            console.trace();
            throw i + ") Should not be an 'output' node";
          }

          node = other;
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
        tmpNetwork.toConnections(node.index).forEach((c) => {
          const fromUUID = tmpNetwork.nodes[c.from].uuid;
          if (!fromUUID) throw "No UUID";
          const from = uuidMap.get(fromUUID);
          if (from === undefined) throw "No index for UUID: " + fromUUID;
          let gater;
          if (c.gater !== undefined) {
            const tmpGater1 = Math.abs(c.gater);
            if (tmpGater1 < i) {
              const gaterUUID = tmpNetwork.nodes[tmpGater1].uuid;
              if (!gaterUUID) throw "No gater UUID";
              const tmpGater2 = uuidMap.get(gaterUUID);
              if (tmpGater2 !== undefined) {
                const tmpGater3 = Math.abs(tmpGater2);
                if (tmpGater3 < i) {
                  gater = tmpGater3;
                }
              }
            }
          }
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
              gater: gater,
              weight: c.weight,
              type: c.type,
            });
          }
        });
      }
    }
    offspring.clear();

    connectionList.forEach((c) => {
      if (offspring.getConnection(c.from, c.to) == null) {
        const co = offspring.connect(
          c.from,
          c.to,
          c.weight,
          c.type,
        );

        co.gater = c.gater;
      }
    });

    offspring.fix();

    return offspring;
  }
}
