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
  | CoordinatedAddSynapseOperation;

export interface CoordinatedRemoveSynapseOperation {
  type: "removeSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
}

export interface CoordinatedAddSynapseOperation {
  type: "addSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
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
