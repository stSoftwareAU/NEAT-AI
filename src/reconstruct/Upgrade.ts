import { NetworkInterface } from "../architecture/NetworkInterface.ts";
import { ConnectionInterface } from "../architecture/ConnectionInterface.ts";
import { Network } from "../architecture/Network.ts";

export class Upgrade {
  static correct(json: NetworkInterface): NetworkInterface {
    const json2 = JSON.parse(JSON.stringify(json)) as NetworkInterface;

    let otherNodes = 0;
    json2.nodes.forEach((n, indx) => {
      if (n.type == "hidden" || n.type == "output" || n.type == "constant") {
        if (!Number.isFinite(n.bias)) {
          console.warn(
            indx + ") '" + n.type + "' invalid bias: " + n.bias +
              ", resetting to zero",
          );
          n.bias = 0;
        }
      }

      if (n.type != "input" && n.type != "output") {
        otherNodes++;
      }

      if (n.squash == "SUM") n.squash = "IDENTITY";
    });

    const firstOutputIndx = json2.input + otherNodes;

    const connections: ConnectionInterface[] = [];
    json2.connections.forEach((c) => {
      if (c.from >= firstOutputIndx && c.from !== c.to) {
        console.warn(
          "Ignoring",
          c.from,
          "=> first output:",
          firstOutputIndx,
          c,
        );
      } else if (c.from > c.to) {
        console.warn("Ignoring", c.from, "> to:", c.to, c);
      } else if ((c.gater ? c.gater : -1) >= firstOutputIndx) {
        console.warn(
          "Ignoring",
          c.gater,
          "=> first output:",
          firstOutputIndx,
          c,
        );
      } else if (!Number.isFinite(c.weight)) {
        console.warn(
          "Ignoring",
          c.weight,
          c,
        );
      } else {
        connections.push(c);
      }
    });

    json2.connections = connections;
    const network = Network.fromJSON(json2);

    network.fix();
    network.validate();
    return network;
  }
}
