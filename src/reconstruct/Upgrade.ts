import { NetworkUtil } from "../architecture/NetworkUtil.ts";
import { NetworkInterface } from "../architecture/NetworkInterface.ts";
import { ConnectionInterface } from "../architecture/ConnectionInterface.ts";

export class Upgrade {
  static correct(json: NetworkInterface): NetworkInterface {
    const json2 = (JSON.parse(JSON.stringify(json)) as NetworkInterface);

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
    });
    const firstOutputIndx = json2.nodes.length - json2.output;

    const connections: ConnectionInterface[] = [];
    json2.connections.forEach((c) => {
      if (c.from >= firstOutputIndx && c.from !== c.to) {
        console.warn(
          "Ingoring connection (from:",
          c.from,
          "=> first output:",
          firstOutputIndx,
          c,
        );
      } else if (c.from > c.to) {
        console.warn("Ingoring connection (from:", c.from, "> to:", c.to, c);
      } else if ((c.gater ? c.gater : -1) >= firstOutputIndx) {
        console.warn(
          "Ingoring connection (gater:",
          c.gater,
          "=> first output:",
          firstOutputIndx,
          c,
        );
      } else if (!Number.isFinite(c.weight)) {
        console.warn(
          "Ingoring connection invalid weight:",
          c.weight,
          c,
        );
      } else {
        connections.push(c);
      }
    });

    json2.connections = connections;
    const network = NetworkUtil.fromJSON(json2);

    network.util.fix();
    network.util.validate();
    return network;
  }
}
