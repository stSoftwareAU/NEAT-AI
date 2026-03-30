import type { TagsInterface } from "@stsoftware/tags/mod";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "@architecture/SynapseInterfaces.ts";
import type {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "@architecture/NeuronInterfaces.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import type { EvolvableHyperparameters } from "@config/HyperparameterConfig.ts";

/**
 * Common properties shared by all creature interfaces.
 */
interface CreatureCommon extends TagsInterface {
  /** Number of input neurons. */
  input: number;

  /** Number of output neurons. */
  output: number;

  /**
   * Marks this creature as forward-only (no recurrent connections).
   *
   * Recurrent connections include:
   * - self-loops (from === to)
   * - feedback/backward connections (from > to)
   *
   * This flag survives export/import and lets production systems enforce that
   * once a creature is confirmed forward-only it stays that way through
   * breeding/mutation.
   */
  forwardOnly?: boolean;

  memetic?: MemeticInterface;

  /** Semantic version of the creature */
  semanticVersion?: string;

  /**
   * Per-creature evolvable hyperparameters.
   *
   * Issue #1863: When hyperparameter evolution is enabled, these values
   * are subject to mutation and crossover like other genes.
   */
  hyperparameters?: EvolvableHyperparameters;
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
 *
 * The JSON schema for this format is defined in `docs/snapshot-schema.json`.
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
