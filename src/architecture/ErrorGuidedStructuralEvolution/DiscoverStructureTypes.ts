/**
 * Types and interfaces for the Error-Guided Structural Evolution discovery system.
 *
 * This module contains all type definitions shared across the discovery pipeline:
 * recording, analysis, focus selection, and application phases.
 */

import type { RustRecordBatchStats } from "./RustDiscovery.ts";
import type {
  CoordinatedStructuralCandidate,
} from "./CoordinatedStructuralCandidate.ts";

export interface DiscoverRecord {
  activation: number;
  errors: number[];
  value?: number;
}

/**
 * Tracks which binary file records were selected during discovery.
 * Maps binary file paths to arrays of record indices.
 */
export interface BinaryRecordIndices {
  [binaryFile: string]: number[];
}

/**
 * Represents a potential new synapse and the associated metrics calculated during discovery.
 */
export interface NeuronStats {
  meanError: number;
  errorVariance: number;
  meanActivation: number;
  activationVariance: number;
  errorSpikeCount: number;
  activationSpikeCount: number;
  activationMin: number;
  activationMax: number;
}

/**
 * Represents a synapse candidate proposed during discovery.
 *
 * As of Rust v0.2.0, this interface uses creature-level metrics:
 * - targetNeuronImpact: 0.0-1.0, where output neurons = 1.0
 * - expectedCreatureErrorReduction: creature-level error reduction
 * - expectedCreatureScoreGain: creature-level score improvement
 *
 * These values are already scaled by the neuron's impact on creature output,
 * so TypeScript should NOT apply additional scaling.
 */
export interface CandidateSynapse {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  weight: number;
  targetNeuronImpact: number;
  expectedCreatureErrorReduction: number;
  expectedCreatureScoreGain: number;
  improvedCount: number;
  totalCount: number;
  /**
   * Optional diagnostic comment (primarily surfaced from Rust candidates).
   * This must not affect ranking/selection logic.
   */
  comment?: string;
  targetNeuronStats?: NeuronStats;
}

/**
 * Represents a squash (activation function) change candidate.
 *
 * As of Rust v0.2.0, this interface uses creature-level metrics:
 * - expectedCreatureScoreGain: creature-level score improvement
 *
 * Note: Squash changes don't have targetNeuronImpact as they modify
 * existing neurons rather than adding new connections.
 */
export interface CandidateSquash {
  neuronUUID: string;
  previousSquash: string;
  squash: string;
  expectedCreatureScoreGain: number;
  improvedError: number;
  currentError: number;
  /**
   * Optional diagnostic comment (primarily for Rust experiments/telemetry).
   * This must not affect ranking/selection logic.
   */
  comment?: string;
}

/**
 * Represents a neuron candidate proposed during discovery.
 *
 * As of Rust v0.2.0, this interface uses creature-level metrics:
 * - targetNeuronImpact: 0.0-1.0, where output neurons = 1.0
 * - expectedCreatureErrorReduction: creature-level error reduction
 * - expectedCreatureScoreGain: creature-level score improvement
 *
 * These values are already scaled by the neuron's impact on creature output,
 * so TypeScript should NOT apply additional scaling.
 */
export interface CandidateNeuron {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  incomingWeight: number;
  outgoingWeight: number;
  squash: string;
  bias: number;
  targetNeuronImpact: number;
  expectedCreatureErrorReduction: number;
  expectedCreatureScoreGain: number;
  improvedCount: number;
  totalCount: number;
  /**
   * Optional diagnostic comment (primarily surfaced from Rust candidates).
   * This must not affect ranking/selection logic.
   */
  comment?: string;
  targetNeuronStats?: NeuronStats;
}

/**
 * Represents a neuron identified as harmful (high error contribution).
 *
 * As of Rust v0.2.0, uses creature-level metrics:
 * - expectedCreatureScoreGain: expected score improvement from removal
 */
export interface CandidateHarmfulNeuron {
  neuronUUID: string;
  errorMagnitude: number;
  expectedCreatureScoreGain: number;
  sampleCount: number;
  averageActivation: number; // Average activation across all samples for efficient bias adjustment
  /**
   * Optional diagnostic comment (primarily for Rust experiments/telemetry).
   * This must not affect ranking/selection logic.
   */
  comment?: string;
}

export interface CandidateAnalysisBundle {
  helpfulSynapses?: CandidateSynapse[];
  harmfulSynapse?: CandidateSynapse;
  helpfulNeurons?: CandidateNeuron[];
  coordinatedStructuralCandidates?: CoordinatedStructuralCandidate[];
  /**
   * Optional metadata returned by NEAT-AI-Discovery for the synapse analysis path.
   * Used for logging only.
   */
  synapseMetadata?: { candidatesFound: number; candidatesReturned: number };
  /**
   * Optional metadata returned by NEAT-AI-Discovery for the neuron analysis path.
   * Used for logging only.
   */
  neuronMetadata?: { candidatesFound: number; candidatesReturned: number };
}

export type FocusSelectionMode = "weighted" | "forced" | "all" | "random";

export interface FocusSelectionSummaryEntry {
  uuid: string;
  weight?: number;
}

export interface FocusSelectionSummary {
  key: string;
  mode: FocusSelectionMode;
  reason: string;
  neurons: FocusSelectionSummaryEntry[];
  totalWeight?: number;
}

export interface NeuronScanStats {
  processed: number;
  total: number;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Detailed neuron focus candidate for JSON analysis output.
 * Includes all metrics needed to understand neuron selection and potential.
 */
export interface FocusNeuronCandidate {
  neuronUuid: string;
  totalError: number;
  impact: number;
  potentialErrorReduction: number;
  activationAffectPct: number;
  weightedScore: number;
  selected: boolean;
}

/**
 * Low-impact neuron candidate for potential removal.
 * These neurons contribute little to outputs and might be pruned.
 */
export interface LowImpactNeuron {
  neuronUuid: string;
  impact: number;
  activationAffectPct: number;
  totalError: number;
  reason: string;
}

/**
 * Complete focus selection analysis for JSON output.
 * Documents all candidates, selection method, and low-impact neurons.
 */
export interface FocusSelectionAnalysis {
  discoveryID: string;
  timestamp: string;
  costOfGrowth: number;
  selectionMethod: string;
  totalCandidates: number;
  selectedCount: number;
  totalWeightedSum: number;
  candidates: FocusNeuronCandidate[];
  lowImpactNeurons: LowImpactNeuron[];
  retryNumber?: number;
}

/**
 * Represents a neuron and its total accumulated error for ranking neurons during discovery.
 * Impact measures how much a neuron affects outputs through its outgoing synapse weights.
 */
export interface NeuronErrorInfo {
  uuid: string;
  totalError: number;
  impact: number;
}

export interface NeuronImpactInfo {
  uuid: string;
  neuronType: string;
  impact: number;
}

export interface RustFlushMetrics extends RustRecordBatchStats {
  recordsWithNoNeuronData: number;
  recordsWithMismatchedNeuronCount: number;
  recordsWithInputMismatch: number;
  recordsWithOutputMismatch: number;
  missingUuidEntries: number;
  nonFiniteActivationCount: number;
  nonFiniteValueCount: number;
  nonFiniteErrorCount: number;
  firstMissingUuidLocation?: string;
  firstNonFiniteActivationLocation?: string;
  firstNonFiniteValueLocation?: string;
  firstNonFiniteErrorLocation?: string;
}

export interface RustFlushDiagnostics {
  summary: string;
  warnings: string[];
  errors: string[];
  metrics: RustFlushMetrics;
}

export interface RustFlushAggregation {
  expectedInputLength: number;
  expectedOutputLength: number;
  expectedNeuronCount: number;
  metrics: RustFlushMetrics;
}

/**
 * Options for configuring DiscoverStructure behaviour (primarily for debugging/testing).
 */
export interface DiscoverStructureOptions {
  /**
   * Base directory for discovery temporary files.
   * Defaults to `.discovery` in the current working directory.
   */
  baseDirectory?: string;

  /**
   * When true, skips cleanup of temporary files after discovery.
   * Useful for debugging to examine parquet files.
   */
  disableCleanup?: boolean;

  /**
   * When true, skips the record phase if parquet files already exist.
   * Useful for debugging to re-run analysis on existing data.
   */
  skipRecordPhase?: boolean;

  /**
   * Estimated payload size threshold (in bytes) before forcing a Rust flush.
   *
   * Primarily for testing and production tuning; defaults to ~50 MiB.
   */
  rustFlushBytesThreshold?: number;
}
