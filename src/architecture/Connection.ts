import { Node } from "./Node.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";

export class Connection implements ConnectionInterface {
  public from: number;
  public to: number;
  public type?: "positive" | "negative" | "condition";
  public gain: number;
  public weight: number;
  public elegibility: number;
  public previousDeltaWeight: number;

  public totalDeltaWeight: number;
  public gater: (Node | null);

  public xtrace: { nodes: Node[]; values: number[] };

  public static randomWeight() {
    return Math.random() * 0.2 - 0.1;
  }

  constructor(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ) {
    // console.info("from", typeof from, "to", typeof to, "weight", typeof weight);

    if (Number.isInteger(from) == false || from < 0) {
      console.trace();
      throw "from should be a non-negative integer was: " + from;
    }
    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + to;
    }
    if (!Number.isFinite(weight)) {
      console.trace();
      throw "weight not a number was: " + weight;
    }
    this.from = from;
    this.to = to;
    this.gain = 1;
    this.type = type;
    this.weight = weight;

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
      from: this.from,
      to: this.to,
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
