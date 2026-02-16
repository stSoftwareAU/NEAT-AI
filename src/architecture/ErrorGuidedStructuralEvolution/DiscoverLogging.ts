/**
 * Logging and diagnostic formatting for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Handles all discovery-related logging: general messages, focus selection
 * details, Rust analysis diagnostics, and candidate formatting.
 */
import { getLogger } from "../../utils/Logger.ts";
import type {
  FocusSelectionSummary,
  NeuronScanStats,
} from "./DiscoverStructureTypes.ts";
import type {
  RustNeuronDiagnostic,
  RustNeuronDiagnosticDetail,
  RustSynapseDiagnostic,
  RustSynapseDiagnosticDetail,
} from "./RustDiscovery.ts";

/**
 * Core logging function with discovery ID prefix.
 */
export function logDiscovery(
  loggingEnabled: boolean,
  discoveryID: string,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  details?: unknown,
): void {
  const prefix = `[Discovery ${discoveryID}] ${message}`;
  const args = details === undefined ? [prefix] : [prefix, details];

  switch (level) {
    case "debug":
      if (loggingEnabled) getLogger().debug(...args);
      break;
    case "info":
      if (loggingEnabled) getLogger().info(...args);
      break;
    case "warn":
      getLogger().warn(...args);
      break;
    case "error":
      getLogger().error(...args);
      break;
    default:
      getLogger().info(...args);
      break;
  }
}

/**
 * Logs details of a focus selection summary.
 */
export function logFocusSelectionDetails(
  loggingEnabled: boolean,
  discoveryID: string,
  scope: "synapse" | "neuron",
  focusList: string[],
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly string[]) => string,
): void {
  const summary = lastFocusSelection;
  const focusKey = focusSelectionKeyFn(focusList);
  if (!summary || summary.key !== focusKey) {
    logDiscovery(
      loggingEnabled,
      discoveryID,
      "warn",
      `Focus selection summary unavailable for ${scope} analysis (focus=${
        focusList.join(", ")
      })`,
    );
    return;
  }
  const displayEntries = summary.neurons.slice(
    0,
    Math.min(5, summary.neurons.length),
  ).map((entry) =>
    entry.weight !== undefined
      ? `${entry.uuid} (weight ${entry.weight.toFixed(4)})`
      : entry.uuid
  );
  const suffix = summary.neurons.length > displayEntries.length ? ", …" : "";
  const totalInfo = summary.totalWeight !== undefined
    ? ` totalWeight=${summary.totalWeight.toFixed(4)}`
    : "";
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "warn",
    `Focus selection [${summary.mode}] ${
      summary.reason ? `(${summary.reason}) ` : ""
    }for ${scope} analysis: ${displayEntries.join(", ")}${suffix}${totalInfo}`,
  );
}

/**
 * Logs when Rust found no improvements.
 */
export function logRustNoImprovement(
  loggingEnabled: boolean,
  discoveryID: string,
  scope: "synapse" | "neuron",
  focusList: string[],
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly string[]) => string,
  diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
): void {
  const preview = focusList.length > 10
    ? `${focusList.slice(0, 10).join(", ")} … (+${focusList.length - 10} more)`
    : focusList.join(", ");
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "warn",
    `Rust ${scope} analysis evaluated ${focusList.length} focus neuron(s) but found no improvements. Focus neurons: ${preview}`,
  );
  logFocusSelectionDetails(
    loggingEnabled,
    discoveryID,
    scope,
    focusList,
    lastFocusSelection,
    focusSelectionKeyFn,
  );
  logRustDiagnostics(loggingEnabled, discoveryID, scope, diagnostics);
}

/**
 * Logs when Rust analysis is unavailable.
 */
export function logRustAnalysisUnavailable(
  loggingEnabled: boolean,
  discoveryID: string,
  scope: "synapse" | "neuron",
  focusList: string[],
  reason: string,
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly string[]) => string,
): void {
  if (focusList.length === 0) {
    return;
  }
  const preview = focusList.length > 10
    ? `${focusList.slice(0, 10).join(", ")} … (+${focusList.length - 10} more)`
    : focusList.join(", ");
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "warn",
    `Rust ${scope} analysis unavailable (${reason}) for focus neuron(s): ${preview}`,
  );
  logFocusSelectionDetails(
    loggingEnabled,
    discoveryID,
    scope,
    focusList,
    lastFocusSelection,
    focusSelectionKeyFn,
  );
}

/**
 * Logs when analysis was skipped due to timeout.
 */
export function logAnalysisSkipped(
  loggingEnabled: boolean,
  discoveryID: string,
  scope: "synapse" | "neuron",
  lastNeuronScanStats: NeuronScanStats | undefined,
): void {
  const stats = lastNeuronScanStats;
  if (!stats?.timedOut) {
    return;
  }
  logDiscovery(
    loggingEnabled,
    discoveryID,
    "warn",
    `Skipping Rust ${scope} analysis because neuron scanning consumed ${
      formatMillis(stats.durationMs)
    } (${stats.processed}/${stats.total} neurons processed).`,
  );
}

/**
 * Type guard to distinguish synapse vs neuron diagnostics.
 */
export function isSynapseDiagnostic(
  diagnostic: RustSynapseDiagnostic | RustNeuronDiagnostic,
): diagnostic is RustSynapseDiagnostic {
  return Object.prototype.hasOwnProperty.call(
    diagnostic,
    "evaluatedCandidates",
  );
}

/**
 * Comprehensive diagnostic logging with statistics.
 */
export function logRustDiagnostics(
  loggingEnabled: boolean,
  discoveryID: string,
  scope: "synapse" | "neuron",
  diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
): void {
  if (!diagnostics || diagnostics.length === 0) {
    logDiscovery(
      loggingEnabled,
      discoveryID,
      "warn",
      `Rust ${scope} analysis did not return diagnostic detail for the evaluated neurons.`,
    );
    return;
  }
  let totalEvaluated = 0;
  let bestImprovement = Number.NEGATIVE_INFINITY;
  let bestDetail:
    | {
      improvement: number;
      threshold?: number;
      weight?: number;
      target: string;
    }
    | undefined;
  diagnostics.forEach((diagnostic) => {
    const evaluated = (diagnostic as RustSynapseDiagnostic)
      .evaluatedCandidates ??
      (diagnostic as RustNeuronDiagnostic).evaluatedSources ??
      0;
    totalEvaluated += evaluated;
    const detail = diagnostic.detail;
    if (detail) {
      const improvement = typeof detail.expectedCreatureScoreGain ===
          "number"
        ? detail.expectedCreatureScoreGain
        : undefined;
      if (
        improvement !== undefined &&
        improvement > bestImprovement
      ) {
        bestImprovement = improvement;
        bestDetail = {
          improvement,
          threshold: detail.threshold,
          weight: (("suggestedWeight" in detail &&
              typeof (detail as RustSynapseDiagnosticDetail)
                  .suggestedWeight === "number")
            ? (detail as RustSynapseDiagnosticDetail).suggestedWeight
            : undefined) ??
            (("outgoingWeight" in detail &&
                typeof (detail as RustNeuronDiagnosticDetail)
                    .outgoingWeight === "number")
              ? (detail as RustNeuronDiagnosticDetail).outgoingWeight
              : undefined),
          target: diagnostic.targetNeuronUuid,
        };
      }
    }
    if (isSynapseDiagnostic(diagnostic)) {
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        formatSynapseDiagnostic(diagnostic),
      );
    } else {
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        formatNeuronDiagnostic(diagnostic),
      );
    }
  });
  if (totalEvaluated > 0) {
    if (bestDetail) {
      const improvementPct = `${(bestDetail.improvement * 100).toFixed(4)}%`;
      const thresholdPct = bestDetail.threshold !== undefined
        ? `${(bestDetail.threshold * 100).toFixed(4)}%`
        : "the configured threshold";
      const weightInfo = bestDetail.weight !== undefined
        ? ` (weight ${bestDetail.weight.toFixed(4)})`
        : "";
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        `Rust ${scope} analysis evaluated ${totalEvaluated} candidate(s); best improvement ${improvementPct} for ${bestDetail.target}${weightInfo} but threshold was ${thresholdPct}.`,
      );
    } else {
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        `Rust ${scope} analysis evaluated ${totalEvaluated} candidate(s) but none produced usable improvement statistics.`,
      );
    }
  } else {
    const first = diagnostics[0];
    if (first) {
      const reason = isSynapseDiagnostic(first)
        ? describeSynapseDiagnosticReason(first.reason)
        : describeNeuronDiagnosticReason(first.reason);
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        `Rust ${scope} analysis reported zero evaluated candidates (${reason}).`,
      );
    } else {
      logDiscovery(
        loggingEnabled,
        discoveryID,
        "warn",
        `Rust ${scope} analysis reported zero evaluated candidates.`,
      );
    }
  }
}

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
 * Formats milliseconds as "Xs YYYms".
 */
export function formatMillis(duration: number): string {
  const seconds = Math.floor(duration / 1000);
  const milliseconds = duration % 1000;
  if (seconds <= 0) {
    return `${milliseconds}ms`;
  }
  return `${seconds}s ${milliseconds.toString().padStart(3, "0")}ms`;
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
    `Rust discovered beneficial synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID} with weight ${
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
    `Rust discovered beneficial ${candidate.squash} neuron linking ${candidate.fromNeuronUUID} -> ${candidate.toNeuronUUID} with incoming ${
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
    `Rust discovered harmful synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID}, expected creature score loss ${
      harmPercent.toFixed(1)
    }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
  );
}
