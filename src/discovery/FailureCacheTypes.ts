/**
 * Failure Cache Types Module
 *
 * Interface and type definitions for the discovery failure cache,
 * including diagnostic metadata and creature change tracking.
 *
 * Extracted from FailureCache.ts as part of #1598.
 */

/** Sample diagnostic information for understanding prediction vs actual results */
export interface SampleDiagnostic {
  /** Index of this sample in the dataset */
  sampleIndex?: number;
  /** Activation of the source neuron for this sample */
  sourceActivation: number;
  /** Average error at the target neuron for this sample */
  avgError: number;
  /** Expected target value (from training data) */
  targetValue?: number;
  /** Actual activation at the target neuron before change */
  targetActivation?: number;
  /** Computed contribution of new neuron/synapse for this sample */
  computedContribution?: number;
}

/** Prediction details from the Rust candidate analysis */
export interface PredictionDetails {
  /** Incoming weight (source -> new neuron, for add-neurons) */
  incomingWeight?: number;
  /** Outgoing weight (new neuron -> target, for add-neurons) */
  outgoingWeight?: number;
  /** Weight for synapse candidates */
  weight?: number;
  /** Bias of the new neuron */
  bias?: number;
  /** Squash function used */
  squash?: string;
  /** Number of samples where improvement was predicted */
  improvedCount?: number;
  /** Total samples analysed */
  totalCount?: number;
}

/** Information about the target neuron */
export interface TargetNeuronInfo {
  /** UUID of the target neuron */
  uuid: string;
  /** Squash function of the target neuron */
  squash: string;
  /** Whether the neuron is at saturation (|activation| > 0.95 for bounded activations) */
  isSaturated?: boolean;
  /** Mean activation across samples */
  meanActivation?: number;
  /** Activation variance */
  activationVariance?: number;
  /** Mean error at this neuron */
  meanError?: number;
  /** Error variance */
  errorVariance?: number;
}

/** Metadata stored alongside cached failures for debugging/analysis */
export interface FailureMetadata {
  originalScore: number;
  candidateScore: number;
  scoreDelta: number;
  error: number;
  /** Re-scored error of the original creature (without candidate changes applied) */
  originalError?: number;
  timestamp?: string;
  /** NEAT-AI-Discovery library version that generated the candidate */
  discoveryVersion?: string;

  // Diagnostic fields for debugging

  /** Diagnostics for first few samples used in prediction */
  sampleDiagnostics?: SampleDiagnostic[];
  /** Prediction details from Rust candidate */
  predictionDetails?: PredictionDetails;
  /** Information about the target neuron */
  targetNeuronInfo?: TargetNeuronInfo;
}

/** Represents the actual neuron state in the creature after changes were applied */
export interface ActualNeuronState {
  uuid: string;
  squash: string;
  bias: number;
}

/** Represents the actual synapse state in the creature after changes were applied */
export interface ActualSynapseState {
  fromUUID: string;
  toUUID: string;
  weight: number;
}

/** Records what actually changed in the creature (for verification against Rust request) */
export interface ActualCreatureChange {
  /** Neurons that were added (with their actual values after fix()) */
  addedNeurons?: ActualNeuronState[];
  /** Synapses connected to added neurons (with actual weights after fix()) */
  addedSynapses?: ActualSynapseState[];
  /** Neurons that were removed */
  removedNeuronUUIDs?: string[];
  /** Synapses that were removed */
  removedSynapseKeys?: string[];
}
