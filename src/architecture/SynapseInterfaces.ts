import type { TagInterface } from "@stsoftware/tags/mod";
import type { SynapseState } from "../propagate/SynapseState.ts";

interface SynapseCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";

  tags?: TagInterface[];
}

/**
 * Interface for internal synapse representation.
 * Used during creature operations and includes index-based connections.
 */
export interface SynapseInternal extends SynapseCommon {
  /** Index of the source neuron */
  from: number;
  /** Index of the destination neuron */
  to: number;
}

/**
 * Interface for exporting synapse data to JSON format.
 * Represents a synapse that can be serialized and shared.
 */
export interface SynapseExport extends SynapseCommon {
  /** UUID of the source neuron */
  fromUUID: string;
  /** UUID of the destination neuron */
  toUUID: string;
}

/**
 * Interface for synapse data with tracing information.
 * Extends SynapseExport to include state tracking for debugging and analysis.
 */
export interface SynapseTrace extends SynapseExport {
  /** State information for tracing synapse behavior */
  trace: SynapseState;
}
