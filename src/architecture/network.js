import { NetworkUtil } from "./NetworkUtil.ts";

export class Network {
  constructor(input, output, options = {}) {
    if (input === undefined || output === undefined) {
      throw new Error("No input or output size given");
    }

    this.input = input;
    this.output = output;
    this.nodes = [];
    this.connections = [];

    this.tags = undefined;

    this.util = new NetworkUtil(this);
    // Just define a variable.
    this.score = undefined;

    if (options) {
      this.util.initialize(options);

      if (this.util.DEBUG) {
        this.util.validate();
      }
    }
  }


}
