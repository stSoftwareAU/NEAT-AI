import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RustRemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type {
  CoordinatedStructuralCandidate,
} from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";

/**
 * Candidate for removal based on low-impact + high-error analysis.
 * Unlike CandidateHarmfulNeuron (which uses error > 1e10 threshold),
 * these are identified by impact < 0.01 AND error > average.
 */
export interface RemovalCandidate {
  neuronUuid: string;
  totalError: number;
  impact: number;
  reason: string;
  /**
   * Mean activation of the removed neuron across the discovery dataset.
   * Used for bias compensation during ablation so downstream neurons preserve
   * their average pre-activation value.
   */
  meanActivation?: number;
  /**
   * Optional diagnostic comment emitted by the Rust discovery engine.
   * This must not affect ranking/selection logic.
   */
  comment?: string;
}

/**
 * Convert Rust removal candidate to local format.
 */
export function fromRustRemovalCandidate(
  rust: RustRemovalCandidate,
): RemovalCandidate {
  return {
    neuronUuid: rust.neuronUuid,
    totalError: rust.totalError,
    impact: rust.impact,
    reason: rust.reason,
    meanActivation: rust.meanActivation,
    comment: rust.comment,
  };
}

export interface DiscoverResult {
  ID: string;
  addHelpfulSynapses: CandidateSynapse[] | undefined;
  addHelpfulNeurons: CandidateNeuron[] | undefined;
  /** Grouped candidates with an ordered `operations[]` list. */
  coordinatedStructuralCandidates?:
    | CoordinatedStructuralCandidate[]
    | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined;
  /** Low-impact neurons flagged for removal (from Rust focus ranking). */
  removalCandidates: RemovalCandidate[] | undefined;

  candidateSquashes: CandidateSquash[] | undefined;
  reScoringTime?: number; // Time spent re-scoring candidates (ms)

  /**
   * Issue #2737: Set to `true` when `DataRecorder.recordFiles()` aborted at the
   * analysis-extension boundary because the V8 heap was at MemoryMonitor
   * CRITICAL pressure. When `true`, every candidate field above is `undefined`
   * — the analysis loop never ran — but the empty result still carries this
   * structured signal so the upstream training event pipeline can surface a
   * `"heap_critical_skip"` outcome instead of silently reporting
   * `"no_change"`.
   *
   * Consumers should treat `heapAbortedAtExtensionBoundary === true` as
   * evidence that structural search was prevented by memory pressure, not as
   * evidence that no structural improvement exists.
   */
  heapAbortedAtExtensionBoundary?: boolean;
}
