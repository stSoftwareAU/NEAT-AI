import { NetworkExport } from "../architecture/NetworkInterfaces.ts";
import { Network } from "../architecture/Network.ts";

export class Upgrade {
  static correct(
    json: NetworkExport,
    input: number,
  ): Network {
    if (!Number.isFinite(input) || input < 1 || !Number.isInteger(input)) {
      throw new Error(`Invalid input size ${input}`);
    }
    const json2 = JSON.parse(JSON.stringify(json));

    const adjIndex = input - json.input;
    if (adjIndex < 0) {
      throw new Error(`Can only expand models ${json.input} -> ${input}`);
    }

    json2.input = input;
    const network = Network.fromJSON(json2);

    network.fix();
    network.validate();
    return network;
  }
}
