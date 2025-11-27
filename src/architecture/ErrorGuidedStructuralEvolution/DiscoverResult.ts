import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructure.ts";
import type { RustRemovalCandidate } from "./RustDiscovery.ts";

/**
 * Candidate for removal based on low-impact + high-error analysis.
 * Unlike CandidateHarmfulNeuron (which uses error > 1e10 threshold),
 * these are identified by impact < 0.01 AND error > average.
 */
export interface RemovalCandidate {
  neuronUUID: string;
  totalError: number;
  impact: number;
  reason: string;
  /** Average activation for bias adjustment during removal (computed lazily). */
  averageActivation?: number;
}

/**
 * Convert Rust removal candidate to local format.
 */
export function fromRustRemovalCandidate(
  rust: RustRemovalCandidate,
): RemovalCandidate {
  return {
    neuronUUID: rust.neuronUuid,
    totalError: rust.totalError,
    impact: rust.impact,
    reason: rust.reason,
  };
}

export interface DiscoverResult {
  ID: string;
  addHelpfulSynapses: CandidateSynapse[] | undefined;
  addHelpfulNeurons: CandidateNeuron[] | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined;
  /** Low-impact neurons flagged for removal (from Rust focus ranking). */
  removalCandidates: RemovalCandidate[] | undefined;

  candidateSquashes: CandidateSquash[] | undefined;
  reScoringTime?: number; // Time spent re-scoring candidates (ms)
}
