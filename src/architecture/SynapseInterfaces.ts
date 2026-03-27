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
   * Runtime source neuron id. Normalised from `fromUUID` when loading; omitted
   * from public serialised snapshots.
   */
  fromId?: number;
  /**
   * Runtime destination neuron id. Normalised from `toUUID` when loading;
   * omitted from public serialised snapshots.
   */
  toId?: number;
  /** Stable wire-format source endpoint (matches neuron `uuid` / `input-N` / `output-N`). */
  fromUUID?: string;
  /** Stable wire-format destination endpoint. */
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
