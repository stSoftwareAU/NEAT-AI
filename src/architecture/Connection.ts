import { ConnectionInterface } from "./ConnectionInterface.ts";

export class Connection implements ConnectionInterface {
  public from: number;
  public to: number;
  public type?: "positive" | "negative" | "condition";
  public weight: number;
  public gater?: number;

  public static randomWeight() {
    return Math.random() * 0.2 - 0.1;
  }

  constructor(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ) {
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
    this.type = type;
    this.weight = weight;

    this.gater = undefined;
  }

  /**
   * Converts the connection to a json object
   */
  toJSON() {
    const json = {
      weight: this.weight,
      from: this.from,
      to: this.to,
      gater: this.gater ? this.gater : undefined,
      type: this.type ? this.type : undefined,
    };

    return json;
  }

  /**
   * Returns an innovation ID
   * https://en.wikipedia.org/wiki/Pairing_function (Cantor pairing function)
   *
   * Just a simple key
   */
  static innovationID(a: number, b: number) {
    if (!Number.isInteger(a)) {
      throw "A) Not a number: " + a;
    }
    if (!Number.isInteger(b)) {
      throw "B) Not a number: " + b;
    }
    return a + ":" + b;
  }
}
