import type { TagsInterface } from "@stsoftware/tags";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./SynapseInterfaces.ts";
import type {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "./NeuronInterfaces.ts";

/**
 * Common properties shared by all creature interfaces.
 */
interface CreatureCommon extends TagsInterface {
  /** Number of input neurons. */
  input: number;

  /** Number of output neurons. */
  output: number;
}

/**
 * Internal representation of a creature, including its unique ID, synapses, and neurons.
 */
export interface CreatureInternal extends CreatureCommon {
  /** Unique identifier for the creature (optional). */
  uuid?: string;

  /** List of synapses in the creature. */
  synapses: SynapseInternal[];

  /** List of neurons in the creature. */
  neurons: NeuronInternal[];

  /** The error plus a discount because of the complexity of the genome (optional). */
  score?: number;
}

/**
 * Export representation of a creature, including its synapses and neurons.
 */
export interface CreatureExport extends CreatureCommon {
  /** List of synapses in the creature. */
  synapses: SynapseExport[];

  /** List of neurons in the creature. */
  neurons: NeuronExport[];
}

/**
 * Trace representation of a creature, including detailed trace information for synapses and neurons.
 */
export interface CreatureTrace extends CreatureExport {
  /** List of synapse traces in the creature. */
  synapses: SynapseTrace[];

  /** List of neuron traces in the creature. */
  neurons: NeuronTrace[];
}
