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

    // Set indexes so we don't need indexOf
    for (let i = network1.nodes.length; i--;) {
      network1.nodes[i].index = i;
    }

    for (let i = network2.nodes.length; i--;) {
      network2.nodes[i].index = i;
    }

    const connectionsMap = new Map<number, ConnectionInterface[]>();
    // Assign nodes from parents to offspring
    for (let i = 0; i < size; i++) {
      // Determine if an output node is needed
      let node;
      if (i < size - network1.output) {
        const random = Math.random();
        node = random >= 0.5 ? network1.nodes[i] : network2.nodes[i];
        const other = random < 0.5 ? network1.nodes[i] : network2.nodes[i];

        if (typeof node === "undefined" || node.type === "output") {
          if (other.type === "output") {
            console.trace();
            throw i + ") Should not be an 'output' node";
          }

          node = other;
        }
      } else {
        if (Math.random() >= 0.5) {
          node = network1.nodes[network1.nodes.length + i - size];
        } else {
          node = network2.nodes[network2.nodes.length + i - size];
        }
        if (node.type !== "output") {
          console.trace();
          throw i + ") expected 'output' was: " + node.type;
        }
      }

      connectionsMap.set(i, (node as Node).network.toConnections(node.index));
      const newNode = new Node(
        node.type,
        node.bias,
        offspring,
        node.squash,
      );

      addTags(newNode, node);

      newNode.index = i;
      offspring.nodes.push(newNode);
    }
    offspring.clear();

    for (let indx = offspring.nodes.length; indx--;) {
      const toList = connectionsMap.get(indx);
      if (toList) {
        for (let i = toList.length; i--;) {
          const c = toList[i];

          const adjustTo = c.to + (indx - c.to);
          let adjustFrom = c.from;
          if (c.to == c.from) {
            adjustFrom = adjustTo;
          } else if (c.from >= offspring.input) {
            adjustFrom = adjustTo - (c.to - c.from);
            if (adjustFrom < offspring.input) {
              if (c.from < adjustTo) {
                adjustFrom = c.from;
              } else {
                adjustFrom = adjustFrom < 0 ? 0 : adjustFrom;
              }
            }
          }

          while (offspring.nodes[adjustFrom].type === "output") {
            adjustFrom--;
          }
          if (offspring.getConnection(adjustFrom, adjustTo) == null) {
            if (offspring.nodes[adjustTo].type !== "constant") {
              const co = offspring.connect(
                adjustFrom,
                adjustTo,
                c.weight,
                c.type,
              );
              if (c.gater !== undefined) {
                if (c.gater < adjustTo) {
                  co.gater = c.gater;
                } else {
                  co.gater = adjustTo - (c.to - c.gater);
                  if (co.gater < 0) {
                    co.gater = 0;
                  }
                }
              }
            }
          }
        }
      }
    }
    offspring.fix();
    return offspring;
  }
}
