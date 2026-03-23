import { assert } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";

/**
 * Represents a synapse (connection) between two neurons in a neural network.
 *
 * A synapse carries a weighted signal from one neuron to another. The weight
 * determines the strength and direction of the connection, and can be modified
 * during training to optimize the network's performance.
 *
 * Key features:
 * - Weighted connections between neurons
 * - Support for different synapse types (positive, negative, condition)
 * - Tagging system for metadata
 * - JSON serialization support
 *
 * @example
 * ```ts
 * const synapse = new Synapse(0, 1, 0.5, "positive");
 * const json = synapse.exportJSON(uuidMap);
 * ```
 */
export class Synapse implements SynapseInternal {
  /** Index of the source neuron */
  public from: number;
  /** Index of the destination neuron */
  public to: number;
  /** Type of synapse (positive, negative, or condition) */
  public type?: "positive" | "negative" | "condition";
  /** Weight of the connection */
  public weight: number;

  /**
   * Issue #1861: When true, this synapse's weight is frozen and will not be
   * modified by backpropagation or mutation.
   */
  public frozen?: boolean;

  /** Tags for storing metadata about the synapse */
  public tags?: TagInterface[];

  /**
   * Generates a random weight value with controlled precision.
   *
   * Creates a weight that is at least one "plank" unit different from zero
   * to ensure meaningful connections in the network.
   *
   * @param scale - Scaling factor for the weight range (default: 1)
   * @returns A random weight value between -scale/2 and scale/2
   */
  public static randomWeight(scale = 1): number {
    const rawWeight = getRandomNumberGenerator().random() * scale - scale / 2;

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

  /**
   * Creates a new synapse instance.
   *
   * @param from - Index of the source neuron
   * @param to - Index of the destination neuron
   * @param weight - Weight of the connection
   * @param type - Optional type of synapse (positive, negative, or condition)
   */
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
   * Converts the synapse to a JSON object for export.
   * Issue #1958: Uses integer neuron IDs instead of UUID strings.
   *
   * @param idMap - Mapping from neuron indices to integer IDs
   * @returns JSON representation of the synapse
   */
  exportJSON(idMap: Map<number, number>): SynapseExport {
    const fromId = idMap.get(this.from) as number;
    const toId = idMap.get(this.to) as number;
    const json: SynapseExport = {
      weight: this.weight,
      fromId: fromId,
      toId: toId,
      type: this.type,
      frozen: this.frozen ? true : undefined,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    return json;
  }

  /**
   * Converts the synapse to internal JSON format.
   *
   * @returns Internal JSON representation with index-based connections
   */
  internalJSON(): SynapseInternal {
    const json: SynapseInternal = {
      weight: this.weight,
      from: this.from,
      to: this.to,
      type: this.type,
      frozen: this.frozen ? true : undefined,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    return json;
  }
}
