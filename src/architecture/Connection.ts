import { Node } from "./Node.ts";

export class Connection {
  public from: Node;
  public to: Node;
  public type?: string;
  public gain: number;
  public weight: number;
  public elegibility: number;
  public previousDeltaWeight: number;

  public totalDeltaWeight: number;
  public gater: (Node | null);

  public xtrace: { nodes: Node[]; values: number[] };

  constructor(from: Node, to: Node, weight: number, type?: string) {
    this.from = from;
    this.to = to;
    this.gain = 1;
    this.type = type;

    this.weight = (typeof weight === "undefined")
      ? Math.random() * 0.2 - 0.1
      : weight;

    this.gater = null;
    this.elegibility = 0;

    // For tracking momentum
    this.previousDeltaWeight = 0;

    // Batch training
    this.totalDeltaWeight = 0;

    this.xtrace = {
      nodes: [],
      values: [],
    };
  }

  /**
   * Converts the connection to a json object
   */
  toJSON() {
    const json = {
      weight: this.weight,
      from: this.from.index,
      to: this.to.index,
      gater: this.gater ? this.gater.index : undefined,
      type: this.type ? this.type : undefined,
    };

    return json;
  }

  /**
   * Returns an innovation ID
   * https://en.wikipedia.org/wiki/Pairing_function (Cantor pairing function)
   */
  static innovationID(a: number, b: number) {
    return 1 / 2 * (a + b) * (a + b + 1) + b;
  }
}
