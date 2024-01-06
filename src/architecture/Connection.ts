import {
  ConnectionExport,
  ConnectionInternal,
} from "./ConnectionInterfaces.ts";

export class Connection implements ConnectionInternal {
  public from: number;
  public to: number;
  public type?: "positive" | "negative" | "condition";
  public weight: number;

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
      throw new Error(`from should be a non-negative integer was: ${from}`);
    }
    if (Number.isInteger(to) == false || to < 0) {
      throw new Error(`to should be a non-negative integer was: ${to}`);
    }
    if (!Number.isFinite(weight)) {
      throw new Error(`weight not a number was: ${weight}`);
    }
    this.from = from;
    this.to = to;
    this.type = type;
    this.weight = weight;
  }

  /**
   * Converts the connection to a json object
   */
  exportJSON(uuidMap: Map<number, string>) {
    const fromUUID = uuidMap.get(this.from);
    const toUUID = uuidMap.get(this.to);
    const json: ConnectionExport = {
      weight: this.weight,
      fromUUID: fromUUID ? fromUUID : `error-${this.from}`,
      toUUID: toUUID ? toUUID : `error-${this.to}`,
      type: this.type ? this.type : undefined,
    };

    return json;
  }

  internalJSON() {
    const json: ConnectionInternal = {
      weight: this.weight,
      from: this.from,
      to: this.to,
      type: this.type ? this.type : undefined,
    };

    return json;
  }
}
