import type { TagInterface } from "@stsoftware/tags";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";
import { assert } from "@std/assert/assert";

export class Synapse implements SynapseInternal {
  public from: number;
  public to: number;
  public type?: "positive" | "negative" | "condition";
  public weight: number;

  public tags?: TagInterface[];

  public static randomWeight(): number {
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
    assert(Number.isFinite(weight), "weight must be a number");
    this.weight = weight;
  }

  /**
   * Converts the connection to a json object
   */
  exportJSON(uuidMap: Map<number, string>): SynapseExport {
    const fromUUID = uuidMap.get(this.from) as string;
    const toUUID = uuidMap.get(this.to) as string;
    const json: SynapseExport = {
      weight: this.weight,
      fromUUID: fromUUID,
      toUUID: toUUID,
      type: this.type,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    return json;
  }

  internalJSON(): SynapseInternal {
    const json: SynapseInternal = {
      weight: this.weight,
      from: this.from,
      to: this.to,
      type: this.type,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    return json;
  }
}
