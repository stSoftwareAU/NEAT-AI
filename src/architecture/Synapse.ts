import { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";

export class Synapse implements SynapseInternal {
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
    this.from = from;
    this.to = to;
    this.type = type;
    this.weight = weight;
  }

  /**
   * Converts the connection to a json object
   */
  exportJSON(uuidMap: Map<number, string>) {
    const fromUUID = uuidMap.get(this.from) as string;
    const toUUID = uuidMap.get(this.to) as string;
    const json: SynapseExport = {
      weight: this.weight,
      fromUUID: fromUUID,
      toUUID: toUUID,
      type: this.type,
    };

    return json;
  }

  internalJSON() {
    const json: SynapseInternal = {
      weight: this.weight,
      from: this.from,
      to: this.to,
      type: this.type,
    };

    return json;
  }
}
