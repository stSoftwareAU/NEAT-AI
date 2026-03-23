/**
 * Coordinated Structural Discovery candidates.
 *
 * These are emitted by NEAT-AI-Discovery (Rust) as *ordered* operation groups.
 * TypeScript must apply the full ordered list as a single ablation and then
 * re-score once on the full training set.
 *
 * Notes:
 * - Operations must be applied in-order.
 * - Cache keying must use a stable hash of the ordered operations list to avoid
 *   poisoning useful epistatic groups.
 */

export type CoordinatedStructuralOperation =
  | CoordinatedRemoveSynapseOperation
  | CoordinatedAddSynapseOperation
  | CoordinatedSetWeightOperation
  | CoordinatedAddNeuronOperation
  | CoordinatedRemoveNeuronOperation
  | CoordinatedChangeSquashOperation
  | CoordinatedSetBiasOperation;

export interface CoordinatedRemoveSynapseOperation {
  type: "removeSynapse";
  fromNeuronId: number;
  toNeuronId: number;
}

export interface CoordinatedAddSynapseOperation {
  type: "addSynapse";
  fromNeuronId: number;
  toNeuronId: number;
  weight: number;
}

export interface CoordinatedSetWeightOperation {
  type: "setWeight";
  fromNeuronId: number;
  toNeuronId: number;
  weight: number;
}

export interface CoordinatedAddNeuronOperation {
  type: "addNeuron";
  /** Deterministic id emitted by Rust so replays remain stable. */
  neuronId: number;
  /** Usually "hidden". Kept explicit to support future use-cases. */
  neuronType: "hidden" | "output";
  squash: string;
  bias: number;
  /**
   * Optional placement hint for forward-only creatures.
   *
   * If set, the neuron will be inserted immediately before this neuron id in
   * the `neurons[]` array so a subsequent `addSynapse(newNeuron -> target)` can
   * satisfy forward-only ordering.
   */
  insertBeforeNeuronId?: number;
}

export interface CoordinatedRemoveNeuronOperation {
  type: "removeNeuron";
  neuronId: number;
}

export interface CoordinatedChangeSquashOperation {
  type: "changeSquash";
  neuronId: number;
  squash: string;
}

export interface CoordinatedSetBiasOperation {
  type: "setBias";
  neuronId: number;
  bias: number;
}

export interface CoordinatedStructuralCandidate {
  type: "coordinated_structural";
  operations: CoordinatedStructuralOperation[];
  /**
   * Expected score gain at the creature level (as returned by Rust).
   * TypeScript must not apply additional impact scaling.
   */
  expectedCreatureScoreGain: number;
  /** Optional diagnostic comment emitted by Rust (must not affect logic). */
  comment?: string;
}
