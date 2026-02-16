/**
 * Analysis and candidate building for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Handles Rust analysis result processing: mapping, filtering, and deduplicating
 * synapse and neuron candidates from the Rust FFI analysis results.
 */
import type {
  CoordinatedStructuralCandidate,
} from "./CoordinatedStructuralCandidate.ts";
import type {
  CandidateAnalysisBundle,
  CandidateNeuron,
  CandidateSynapse,
} from "./DiscoverStructureTypes.ts";
import type {
  RustAnalyzeAllResult,
  RustCandidateNeuron,
  RustCandidateSynapse,
  RustNeuronDiagnostic,
  RustSynapseDiagnostic,
} from "./RustDiscovery.ts";

/**
 * Maps a RustCandidateSynapse to CandidateSynapse.
 */
export function mapRustCandidate(
  candidate: RustCandidateSynapse,
): CandidateSynapse {
  return {
    fromNeuronUUID: candidate.fromNeuronUuid,
    toNeuronUUID: candidate.toNeuronUuid,
    weight: candidate.weight,
    targetNeuronImpact: candidate.targetNeuronImpact,
    expectedCreatureErrorReduction: candidate.expectedCreatureErrorReduction,
    expectedCreatureScoreGain: candidate.expectedCreatureScoreGain,
    improvedCount: candidate.improvedCount,
    totalCount: candidate.totalCount,
    comment: candidate.comment,
    targetNeuronStats: candidate.targetNeuronStats,
  };
}

/**
 * Maps a RustCandidateNeuron to CandidateNeuron.
 */
export function mapRustNeuronCandidate(
  candidate: RustCandidateNeuron,
): CandidateNeuron {
  return {
    fromNeuronUUID: candidate.sourceNeuronUuid,
    toNeuronUUID: candidate.targetNeuronUuid,
    incomingWeight: candidate.incomingWeight,
    outgoingWeight: candidate.outgoingWeight,
    squash: candidate.squash,
    bias: candidate.bias,
    targetNeuronImpact: candidate.targetNeuronImpact,
    expectedCreatureErrorReduction: candidate.expectedCreatureErrorReduction,
    expectedCreatureScoreGain: candidate.expectedCreatureScoreGain,
    improvedCount: candidate.improvedCount,
    totalCount: candidate.totalCount,
    comment: candidate.comment,
    targetNeuronStats: candidate.targetNeuronStats,
  };
}

/**
 * Generates key string for synapse candidate dedup.
 */
export function candidateKey(candidate: CandidateSynapse): string {
  return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
}

/**
 * Generates key string for neuron candidate dedup.
 */
export function neuronCandidateKey(candidate: CandidateNeuron): string {
  return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
}

/**
 * Upserts a synapse candidate into discoveries list, sorted by score gain.
 */
export function upsertDiscovery(
  discoveries: CandidateSynapse[],
  candidate: CandidateSynapse,
): void {
  const key = candidateKey(candidate);
  const existingIndex = discoveries.findIndex((existing) =>
    candidateKey(existing) === key
  );
  if (existingIndex >= 0) {
    discoveries[existingIndex] = candidate;
  } else {
    discoveries.push(candidate);
  }
  discoveries.sort((a, b) =>
    b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
  );
}

/**
 * Upserts a neuron candidate into neuronDiscoveries list, sorted by score gain.
 */
export function upsertNeuronDiscovery(
  neuronDiscoveries: CandidateNeuron[],
  candidate: CandidateNeuron,
): void {
  const key = neuronCandidateKey(candidate);
  const existingIndex = neuronDiscoveries.findIndex((existing) =>
    neuronCandidateKey(existing) === key
  );
  if (existingIndex >= 0) {
    neuronDiscoveries[existingIndex] = candidate;
  } else {
    neuronDiscoveries.push(candidate);
  }
  neuronDiscoveries.sort((a, b) =>
    b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
  );
}

/**
 * Groups synapse candidates by target neuron, keeps best per target.
 */
export function filterTopSynapseCandidates(
  candidates: CandidateSynapse[],
): CandidateSynapse[] {
  const grouped = new Map<string, CandidateSynapse>();
  candidates.forEach((candidate) => {
    const existing = grouped.get(candidate.toNeuronUUID);
    if (
      !existing ||
      candidate.expectedCreatureScoreGain >
        existing.expectedCreatureScoreGain
    ) {
      grouped.set(candidate.toNeuronUUID, candidate);
    }
  });
  return Array.from(grouped.values());
}

/**
 * Groups neuron candidates by target neuron, keeps best per target.
 */
export function filterTopNeuronCandidates(
  candidates: CandidateNeuron[],
): CandidateNeuron[] {
  const grouped = new Map<string, CandidateNeuron>();
  candidates.forEach((candidate) => {
    const existing = grouped.get(candidate.toNeuronUUID);
    if (
      !existing ||
      candidate.expectedCreatureScoreGain >
        existing.expectedCreatureScoreGain
    ) {
      grouped.set(candidate.toNeuronUUID, candidate);
    }
  });
  return Array.from(grouped.values()).sort((a, b) =>
    b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
  );
}

/**
 * Reads helpful synapse candidates from cached Rust analysis.
 */
export function tryRustHelpfulSynapses(
  rustResult: RustAnalyzeAllResult | undefined,
  logRustNoImprovementFn: (
    scope: "synapse" | "neuron",
    diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
  ) => void,
): CandidateSynapse[] | undefined {
  const synapseResult = rustResult?.synapse;
  if (!synapseResult) {
    return undefined;
  }

  const helpfulSynapses = synapseResult.helpfulSynapses ?? [];
  if (helpfulSynapses.length === 0) {
    logRustNoImprovementFn("synapse", synapseResult.diagnostics);
    return [];
  }

  const candidates = helpfulSynapses
    .map((candidate) => mapRustCandidate(candidate))
    .filter((candidate) => candidate.expectedCreatureScoreGain > 0);

  if (candidates.length === 0) {
    logRustNoImprovementFn("synapse", synapseResult.diagnostics);
    return [];
  }

  const topCandidates = filterTopSynapseCandidates(candidates);
  if (topCandidates.length === 0) {
    logRustNoImprovementFn("synapse", synapseResult.diagnostics);
    return [];
  }

  topCandidates.sort((a, b) =>
    b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
  );
  return topCandidates;
}

/**
 * Reads harmful synapse candidates from Rust analysis.
 */
export function tryRustHarmfulCandidates(
  rustResult: RustAnalyzeAllResult | undefined,
): CandidateSynapse[] | undefined {
  const synapseResult = rustResult?.synapse;
  if (!synapseResult || !synapseResult.harmfulSynapses) {
    return undefined;
  }

  const candidates = synapseResult.harmfulSynapses
    .map((candidate) => mapRustCandidate(candidate))
    .filter((candidate) => candidate.expectedCreatureScoreGain < 0);

  if (candidates.length === 0) {
    return [];
  }

  // For harmful synapses, sort by most negative (most harmful) first
  candidates.sort((a, b) =>
    a.expectedCreatureScoreGain - b.expectedCreatureScoreGain
  );
  return candidates;
}

/**
 * Reads helpful neuron candidates from cached Rust analysis.
 */
export function tryRustHelpfulNeurons(
  rustResult: RustAnalyzeAllResult | undefined,
  logRustNoImprovementFn: (
    scope: "synapse" | "neuron",
    diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
  ) => void,
): CandidateNeuron[] | undefined {
  const neuronResult = rustResult?.neuron;
  if (!neuronResult) {
    return undefined;
  }

  const helpfulNeurons = neuronResult.helpfulNeurons ?? [];
  if (helpfulNeurons.length === 0) {
    logRustNoImprovementFn("neuron", neuronResult.diagnostics);
    return [];
  }

  const candidates = helpfulNeurons
    .map((candidate) => mapRustNeuronCandidate(candidate))
    .filter((candidate) => candidate.expectedCreatureScoreGain > 0);

  if (candidates.length === 0) {
    logRustNoImprovementFn("neuron", neuronResult.diagnostics);
    return [];
  }

  candidates.sort((a, b) =>
    b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
  );
  return candidates;
}

/**
 * Reads coordinated structural candidates from Rust analysis.
 */
export function tryRustCoordinatedStructuralCandidates(
  rustResult: RustAnalyzeAllResult | undefined,
): CoordinatedStructuralCandidate[] | undefined {
  const neuronResult = rustResult?.neuron;
  if (!neuronResult) {
    return undefined;
  }

  const candidates = neuronResult.coordinatedStructuralCandidates ?? [];
  if (candidates.length === 0) {
    return [];
  }

  return [...candidates].sort((a, b) =>
    (b.expectedCreatureScoreGain ?? 0) - (a.expectedCreatureScoreGain ?? 0)
  );
}

/**
 * Bundles all candidate types (synapses, neurons, coordinated) into CandidateAnalysisBundle.
 */
export function collectRustAnalysisCandidates(
  combinedResult: RustAnalyzeAllResult | undefined,
  _focusList: string[],
  logRustNoImprovementFn: (
    scope: "synapse" | "neuron",
    diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
  ) => void,
): CandidateAnalysisBundle | undefined {
  if (!combinedResult) {
    return undefined;
  }

  const bundle: CandidateAnalysisBundle = {};
  if (combinedResult.synapse?.metadata) {
    bundle.synapseMetadata = combinedResult.synapse.metadata;
  }
  if (combinedResult.neuron?.metadata) {
    bundle.neuronMetadata = combinedResult.neuron.metadata;
  }

  const helpfulSynapses = tryRustHelpfulSynapses(
    combinedResult,
    logRustNoImprovementFn,
  );
  if (helpfulSynapses && helpfulSynapses.length > 0) {
    bundle.helpfulSynapses = helpfulSynapses;
  }

  const harmfulSynapses = tryRustHarmfulCandidates(combinedResult);
  if (harmfulSynapses && harmfulSynapses.length > 0) {
    bundle.harmfulSynapse = harmfulSynapses[0];
  }

  const helpfulNeurons = tryRustHelpfulNeurons(
    combinedResult,
    logRustNoImprovementFn,
  );
  if (helpfulNeurons && helpfulNeurons.length > 0) {
    bundle.helpfulNeurons = helpfulNeurons;
  }

  const coordinated = tryRustCoordinatedStructuralCandidates(combinedResult);
  if (coordinated && coordinated.length > 0) {
    bundle.coordinatedStructuralCandidates = coordinated;
  }

  return bundle;
}
