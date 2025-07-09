import type { TagsInterface } from "@stsoftware/tags/mod";
import type { NeuronStateInterface } from "./CreatureState.ts";

interface NeuronAbstract extends TagsInterface {
  uuid?: string;
  bias?: number;
  squash?: string;
}

/**
 * Interface for exporting neuron data to JSON format.
 * Represents a neuron that can be serialized and shared.
 */
export interface NeuronExport extends NeuronAbstract {
  /** The type of neuron - hidden, output, or constant */
  readonly type: "hidden" | "output" | "constant";
  /** Unique identifier for the neuron */
  readonly uuid: string;
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
  /** State information for tracing neuron behavior */
  trace: NeuronStateInterface;
}
