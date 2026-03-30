import type { TagsInterface } from "@stsoftware/tags/mod";
import type { NeuronStateInterface } from "@architecture/CreatureState.ts";

interface NeuronAbstract extends TagsInterface {
  /**
   * Runtime integer id (Issue #1958). Omitted from public exports; not stable
   * across generations.
   */
  id?: number;
  /** Stable wire-format identity for hidden/constant neurons (RFC 4122). */
  uuid?: string;
  bias?: number;
  squash?: string;

  /**
   * Issue #1861: When true, this neuron's bias is frozen and will not be
   * modified by backpropagation or mutation. Used for transfer learning to
   * preserve learned biases from a pre-trained creature.
   */
  frozen?: boolean;
}

/**
 * Interface for exporting neuron data to JSON format.
 * Represents a neuron that can be serialized and shared.
 */
export interface NeuronExport extends NeuronAbstract {
  /** The type of neuron - hidden, output, or constant */
  readonly type: "hidden" | "output" | "constant";
  /**
   * Internal integer identifier (Issue #1958). Omitted from new exports; use `uuid`.
   */
  readonly id?: number;
  /** Bias value for the neuron */
  bias: number;
  /** Activation function name for the neuron */
  squash?: string;
}

/**
 * Interface for internal neuron representation.
 * Used during creature operations and includes index information.
 */
export interface NeuronInternal extends NeuronAbstract {
  /** The type of neuron - input, hidden, output, or constant */
  readonly type: "input" | "hidden" | "output" | "constant";
  /** Index position of the neuron in the network */
  index: number;
}

/**
 * Interface for neuron data with tracing information.
 * Extends NeuronExport to include state tracking for debugging and analysis.
 */
export interface NeuronTrace extends NeuronExport {
  /** State information for tracing neuron behaviour */
  trace: NeuronStateInterface;
}
