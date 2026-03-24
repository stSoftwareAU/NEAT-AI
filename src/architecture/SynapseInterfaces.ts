import type { TagInterface } from "@stsoftware/tags/mod";
import type { SynapseState } from "../propagate/SynapseState.ts";

interface SynapseCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";

  /**
   * Issue #1861: When true, this synapse's weight is frozen and will not be
   * modified by backpropagation or mutation. Used for transfer learning to
   * preserve learned weights from a pre-trained creature.
   */
  frozen?: boolean;

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
 * Represents a synapse that can be serialised and shared.
 * Issue #1958: Uses integer neuron IDs instead of UUID strings.
 */
export interface SynapseExport extends SynapseCommon {
  /**
   * Integer ID of the source neuron (Issue #1958).
   * Optional for backward compatibility with legacy UUID-format data;
   * new exports always include this field.
   */
  fromId?: number;
  /**
   * Integer ID of the destination neuron (Issue #1958).
   * Optional for backward compatibility with legacy UUID-format data;
   * new exports always include this field.
   */
  toId?: number;
  /** @deprecated Legacy UUID string field. Use `fromId` instead. (Issue #1958) */
  fromUUID?: string;
  /** @deprecated Legacy UUID string field. Use `toId` instead. (Issue #1958) */
  toUUID?: string;
}

/**
 * Interface for synapse data with tracing information.
 * Extends SynapseExport to include state tracking for debugging and analysis.
 */
export interface SynapseTrace extends SynapseExport {
  /** State information for tracing synapse behavior */
  trace: SynapseState;
}
