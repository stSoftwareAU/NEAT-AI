import type { TagsInterface } from "@stsoftware/tags/mod";
import type { NeuronStateInterface } from "./CreatureState.ts";

interface NeuronAbstract extends TagsInterface {
  /**
   * Issue #1958: Integer neuron ID replacing UUID strings.
   * Input neurons: id = inputIndex (0, 1, 2, ...)
   * Output neurons: id = -(outputIndex + 1) (-1, -2, -3, ...)
   * Hidden/constant neurons: monotonically increasing positive integer
   */
  id?: number;
  /** @deprecated Legacy UUID string field. Use `id` instead. (Issue #1958) */
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
   * Integer identifier for the neuron (Issue #1958).
   * Optional for backward compatibility with legacy UUID-format data;
   * new exports always include this field.
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
