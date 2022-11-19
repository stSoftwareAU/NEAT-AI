import { TagInterface } from "../tags/TagInterface.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { NetworkUtil } from "./NetworkUtil.ts";
import { NodeInterface } from "./NodeInterface.ts";

export class Network {
  readonly input: number;
  readonly output: number;
  util: NetworkUtil;
  nodes: NodeInterface[];
  tags?: TagInterface[];
  score?: number;
  connections: ConnectionInterface[];
  constructor(input: number, output: number, options = {}) {
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
