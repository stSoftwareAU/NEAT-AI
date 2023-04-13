import { NetworkExport } from "../architecture/NetworkInterfaces.ts";
import { Network } from "../architecture/Network.ts";

export class Upgrade {
  static correct(json: NetworkExport, input: number): Network {
    if (!Number.isFinite(input) || input < 1) {
      console.trace();
      throw `Invalid input size ${input}`;
    }
    const json2 = JSON.parse(JSON.stringify(json)) as NetworkExport;

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

      if (n.squash == "SUM") n.squash = "IDENTITY";
    });
    json2.input = input;
    const network = Network.fromJSON(json2);

    network.fix();
    network.validate();
    return network;
  }
}
