import {
  NetworkExport,
  NetworkInternal,
} from "../architecture/NetworkInterfaces.ts";
import { Network } from "../architecture/Network.ts";

export class Upgrade {
  static correct(
    json: NetworkExport | NetworkInternal,
    input: number,
  ): Network {
    if (!Number.isFinite(input) || input < 1 || !Number.isInteger(input)) {
      console.trace();
      throw `Invalid input size ${input}`;
    }
    const json2 = JSON.parse(JSON.stringify(json));

    const adjIndex = input - json.input;
    if (adjIndex > 0) {
      json2.nodes.forEach((n: { index: number }) => {
        if (n.index >= json2.input) {
          n.index = n.index + adjIndex;
        }
      });

      json2.connections.forEach((c: { from: number; to: number }) => {
        if (c.from >= json2.input) {
          c.from = c.from + adjIndex;
        }
        if (c.to >= json2.input) {
          c.to = c.to + adjIndex;
        }
      });

      json2.input = input;
    } else if (adjIndex < 0) {
      throw `Can only expand models ${json.input} -> ${input}`;
    }

    json2.nodes.forEach(
      (n: { type: string; bias: number; squash: string }, indx: number) => {
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
      },
    );

    const network = Network.fromJSON(json2);

    network.fix();
    network.validate();
    return network;
  }
}
