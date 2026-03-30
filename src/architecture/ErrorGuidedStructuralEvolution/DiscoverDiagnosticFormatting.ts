/**
 * Diagnostic formatting and candidate logging for discovery.
 *
 * Formats Rust synapse and neuron diagnostics for human-readable logging,
 * maps diagnostic reason codes, and logs discovered candidates.
 */
import type {
  RustNeuronDiagnostic,
  RustSynapseDiagnostic,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { logDiscovery } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverLoggingCore.ts";

/**
 * Formats a RustSynapseDiagnostic for logging.
 */
export function formatSynapseDiagnostic(
  diagnostic: RustSynapseDiagnostic,
): string {
  const reason = describeSynapseDiagnosticReason(diagnostic.reason);
  const detailParts = [
    `evaluated=${diagnostic.evaluatedCandidates}`,
    `withSamples=${diagnostic.candidatesWithSamples}`,
    `targetRecords=${diagnostic.targetRecordCount}`,
  ];
  if (diagnostic.detail) {
    const detail = diagnostic.detail;
    if (detail.sourceNeuronUuid) {
      detailParts.push(`source=${detail.sourceNeuronUuid}`);
    }
    if (detail.sampleCount !== undefined) {
      detailParts.push(`samples=${detail.sampleCount}`);
    }
    if (
      detail.improvedCount !== undefined ||
      detail.worsenedCount !== undefined
    ) {
      detailParts.push(
        `improved=${detail.improvedCount ?? 0}/worsened=${
          detail.worsenedCount ?? 0
        }`,
      );
    }
    if (detail.expectedCreatureScoreGain !== undefined) {
      detailParts.push(
        `expected=${(detail.expectedCreatureScoreGain * 100).toFixed(2)}%`,
      );
    }
    if (detail.threshold !== undefined) {
      detailParts.push(`threshold=${(detail.threshold * 100).toFixed(2)}%`);
    }
    if (detail.suggestedWeight !== undefined) {
      detailParts.push(`weight=${detail.suggestedWeight.toFixed(4)}`);
    }
  }
  return `Rust synapse diagnostic for ${diagnostic.targetNeuronUuid}: ${reason} (${
    detailParts.join(", ")
  })`;
}

/**
 * Formats a RustNeuronDiagnostic for logging.
 */
export function formatNeuronDiagnostic(
  diagnostic: RustNeuronDiagnostic,
): string {
  const reason = describeNeuronDiagnosticReason(diagnostic.reason);
  const detailParts = [
    `evaluated=${diagnostic.evaluatedSources}`,
    `withSamples=${diagnostic.sourcesWithSamples}`,
    `targetRecords=${diagnostic.targetRecordCount}`,
  ];
  if (diagnostic.detail) {
    const detail = diagnostic.detail;
    if (detail.sourceNeuronUuid) {
      detailParts.push(`source=${detail.sourceNeuronUuid}`);
    }
    if (detail.orientation) {
      detailParts.push(`orientation=${detail.orientation}`);
    }
    if (detail.sampleCount !== undefined) {
      detailParts.push(`samples=${detail.sampleCount}`);
    }
    if (
      detail.improvedCount !== undefined ||
      detail.worsenedCount !== undefined
    ) {
      detailParts.push(
        `improved=${detail.improvedCount ?? 0}/worsened=${
          detail.worsenedCount ?? 0
        }`,
      );
    }
    if (detail.expectedCreatureScoreGain !== undefined) {
      detailParts.push(
        `expected=${(detail.expectedCreatureScoreGain * 100).toFixed(2)}%`,
      );
    }
    if (detail.threshold !== undefined) {
      detailParts.push(`threshold=${(detail.threshold * 100).toFixed(2)}%`);
    }
    if (detail.outgoingWeight !== undefined) {
      detailParts.push(`outgoing=${detail.outgoingWeight.toFixed(4)}`);
    }
  }
  return `Rust neuron diagnostic for ${diagnostic.targetNeuronUuid}: ${reason} (${
    detailParts.join(", ")
  })`;
}

/**
 * Maps synapse diagnostic reason codes to human-readable strings.
 */
export function describeSynapseDiagnosticReason(
  reason: RustSynapseDiagnostic["reason"],
): string {
  switch (reason) {
    case "no_eligible_sources":
      // Note: This may indicate a Rust library issue - all non-input neurons should have
      // inward synapses. If this appears for valid neurons, it may be a filtering issue
      // in the Rust library (e.g., all potential sources are already connected or filtered out).
      return "No eligible upstream sources";
    case "no_diagnostics":
      return "No diagnostics recorded";
    case "no_samples":
      return "No aligned samples found";
    case "zero_improvement":
      return "Zero net improvement observed";
    case "below_threshold":
      return "Expected improvement below threshold";
    default:
      return reason;
  }
}

/**
 * Maps neuron diagnostic reason codes to human-readable strings.
 */
export function describeNeuronDiagnosticReason(
  reason: RustNeuronDiagnostic["reason"],
): string {
  switch (reason) {
    case "no_eligible_sources":
      // Note: This may indicate a Rust library issue - all non-input neurons should have
      // inward synapses. If this appears for valid neurons, it may be a filtering issue
      // in the Rust library (e.g., all potential sources are already connected or filtered out).
      return "No eligible upstream sources";
    case "no_diagnostics":
      return "No diagnostics recorded";
    case "no_samples":
      return "No aligned samples detected";
    case "not_enough_activations":
      return "Not enough activations to evaluate";
    case "weight_degenerate":
      return "Degenerate outgoing weight";
    case "below_threshold":
      return "Expected improvement below threshold";
    default:
      return reason;
  }
}

/**
 * Logs info about a discovered beneficial synapse.
 */
export function logHelpfulSynapse(
  loggingEnabled: boolean,
  discoveryID: string,
  candidate: import("./DiscoverStructureTypes.ts").CandidateSynapse,
): void {
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "info",
    `Rust discovered beneficial synapse from ${candidate.fromNeuronUuid} to ${candidate.toNeuronUuid} with weight ${
      candidate.weight.toFixed(4)
    }, expected creature score gain ${
      (candidate.expectedCreatureScoreGain * 100).toFixed(1)
    }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
  );
}

/**
 * Logs info about a discovered beneficial neuron.
 */
export function logHelpfulNeuron(
  loggingEnabled: boolean,
  discoveryID: string,
  candidate: import("./DiscoverStructureTypes.ts").CandidateNeuron,
): void {
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "info",
    `Rust discovered beneficial ${candidate.squash} neuron linking ${candidate.fromNeuronUuid} -> ${candidate.toNeuronUuid} with incoming ${
      candidate.incomingWeight.toFixed(4)
    } and outgoing ${
      candidate.outgoingWeight.toFixed(4)
    }, expected creature score gain ${
      (candidate.expectedCreatureScoreGain * 100).toFixed(1)
    }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
  );
}

/**
 * Logs info about a discovered harmful synapse.
 */
export function logHarmfulSynapse(
  loggingEnabled: boolean,
  discoveryID: string,
  candidate: import("./DiscoverStructureTypes.ts").CandidateSynapse,
): void {
  const harmPercent = Math.abs(candidate.expectedCreatureScoreGain * 100);
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "info",
    `Rust discovered harmful synapse from ${candidate.fromNeuronUuid} to ${candidate.toNeuronUuid}, expected creature score loss ${
      harmPercent.toFixed(1)
    }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
  );
}
