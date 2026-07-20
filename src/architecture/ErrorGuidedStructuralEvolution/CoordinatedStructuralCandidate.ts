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
  fromNeuronUuid: string;
  toNeuronUuid: string;
}

export interface CoordinatedAddSynapseOperation {
  type: "addSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
}

export interface CoordinatedSetWeightOperation {
  type: "setWeight";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
}

export interface CoordinatedAddNeuronOperation {
  type: "addNeuron";
  neuronUuid: string;
  /** Usually "hidden". Kept explicit to support future use-cases. */
  neuronType: "hidden" | "output";
  squash: string;
  bias: number;
  /**
   * Optional placement hint for forward-only creatures.
   *
   * If set, the neuron will be inserted immediately before this neuron uuid in
   * the `neurons[]` array so a subsequent `addSynapse(newNeuron -> target)` can
   * satisfy forward-only ordering.
   */
  insertBeforeNeuronUuid?: string;
}

export interface CoordinatedRemoveNeuronOperation {
  type: "removeNeuron";
  neuronUuid: string;
}

export interface CoordinatedChangeSquashOperation {
  type: "changeSquash";
  neuronUuid: string;
  squash: string;
}

export interface CoordinatedSetBiasOperation {
  type: "setBias";
  neuronUuid: string;
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
  /**
   * Variance-aware weight-redistribution compensation for a sole-op
   * `removeNeuron` candidate whose removed neuron carries per-sample variance
   * (NEAT-AI-Discovery #1559/#1689, consumed here per Issue #1691).
   *
   * When present, the applier bumps the correlated survivor's weight into the
   * shared target by `deltaWeight` *in addition to* the mean bias fold, rather
   * than applying a mean-only fold. Absent for constant-neuron candidates (which
   * carry `constantNeuronBiasFold` instead) and for older Discovery builds that
   * emit no compensation — those fall back to the mean-only fold unchanged.
   */
  removeNeuronCompensation?: RemoveNeuronCompensation;
  /**
   * Constant-neuron bias-fold compensation for a sole-op `removeNeuron`
   * candidate whose removed neuron is functionally constant (NEAT-AI-Discovery
   * #1623/#1690, consumed here per Issue #1691).
   *
   * When present, the applier folds each pre-computed per-target bias delta into
   * the downstream biases exactly, then removes the neuron. Absent for
   * variance-carrying candidates and for older Discovery builds.
   */
  constantNeuronBiasFold?: ConstantNeuronBiasFold;
}

/**
 * Variance-aware weight-redistribution remedy attached to a remove-neuron
 * candidate (NEAT-AI-Discovery #1559 counterfactual (d)).
 *
 * The compact covariance sufficient statistic travels alongside the remedy so
 * the applier can redistribute the removed neuron's per-sample downstream signal
 * into a correlated survivor's weight without re-reading per-sample activations.
 */
export interface RemoveNeuronCompensation {
  /** Downstream neuron both the removed candidate and the survivor feed. */
  targetNeuronUuid: string;
  /** Surviving neuron whose weight into `targetNeuronUuid` absorbs the signal. */
  survivorNeuronUuid: string;
  /** Least-squares weight bump to add to the survivor's weight: `Δw = w_c·cov/var(a_s)`. */
  deltaWeight: number;
  /** Number of aligned per-sample activation pairs behind the statistic. */
  sampleCount: number;
  /** Population variance of the removed neuron's per-sample activation. */
  candidateVariance: number;
  /** Population variance of the survivor's per-sample activation. */
  survivorVariance: number;
  /** Population covariance of the candidate and survivor activations. */
  covariance: number;
  /** Candidate/survivor activation correlation in `[-1, 1]`. */
  correlation: number;
  /** Per-sample residual variance under the mean-only bias fold. */
  biasOnlyResidualVariance: number;
  /** Per-sample residual variance after weight redistribution. */
  redistributedResidualVariance: number;
  /** Variance recovered by redistribution over the bias-only fold (`≥ 0`). */
  varianceRecovered: number;
  /** `true` when redistribution drives the residual variance to ~0. */
  fullyCompensable: boolean;
}

/**
 * A single downstream target that absorbs a folded constant-neuron bias delta
 * (NEAT-AI-Discovery #1623).
 */
export interface FoldedBiasDelta {
  /** Downstream neuron whose bias absorbs the constant contribution. */
  targetNeuronUuid: string;
  /** Bias delta to add to the target: `outgoingWeight × constantActivation`. */
  biasDelta: number;
}

/**
 * Constant-neuron bias-fold remedy attached to a remove-neuron candidate
 * (NEAT-AI-Discovery #1623). A constant neuron carries no per-sample variance,
 * so folding its fixed contribution into downstream biases is exact.
 */
export interface ConstantNeuronBiasFold {
  /** The mean activation used as the folded constant `c`. */
  constantActivation: number;
  /** Population variance over the recorded window — (near-)zero when constant. */
  activationVariance: number;
  /** Maximum per-sample residual `|w·(a_i − c)|`, at or below the gate tolerance. */
  maxResidual: number;
  /** Per-target bias deltas the applier adds before deleting the neuron. */
  foldedTargets: FoldedBiasDelta[];
}

/**
 * Optional compensation payload attached to a remove-neuron candidate, carrying
 * either the variance-aware weight redistribution or the constant-neuron bias
 * fold (never both). Absent entirely for older Discovery builds — the applier
 * then falls back to the mean-only bias fold (Issue #1691).
 */
export interface RemoveNeuronCompensationData {
  removeNeuronCompensation?: RemoveNeuronCompensation;
  constantNeuronBiasFold?: ConstantNeuronBiasFold;
}
