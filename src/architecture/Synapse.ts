import type { TagInterface } from "@stsoftware/tags/mod";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";
import { assert } from "@std/assert/assert";

export class Synapse implements SynapseInternal {
  public from: number;
  public to: number;
  public type?: "positive" | "negative" | "condition";
  public weight: number;

  public tags?: TagInterface[];

  /** create a random weight between -0.5 and 0.5 */
  public static randomWeight(scale = 1): number {
    const rawWeight = Math.random() * scale - scale / 2;

    const plank = 0.000_000_1;
    /* Ensure the weight is at least one plank different and within sensible limits */
    const weightUnit = Math.max(
      Math.round(Math.abs(rawWeight / plank)),
      1,
    );

    const weight = Math.sign(rawWeight) * weightUnit * plank;
    assert(
      Math.abs(weight) >= plank,
      `weight must be at least ${plank}, was ${weight}, rawWeight ${rawWeight}, weightUnit ${weightUnit}, plank ${plank}`,
    );
    assert(
      Number.isFinite(weight),
      `weight must be a number was ${weight}, rawWeight ${rawWeight}, weightUnit ${weightUnit}, plank ${plank}`,
    );

    return weight;
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
