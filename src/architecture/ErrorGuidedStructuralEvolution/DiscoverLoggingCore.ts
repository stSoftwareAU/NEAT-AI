/**
 * Core discovery logging functions.
 *
 * Provides the central logging function with discovery ID prefix,
 * focus selection details, analysis status logging, and utility formatters.
 */
import { getLogger } from "@utils/Logger.ts";
import type {
  FocusSelectionSummary,
  NeuronScanStats,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import type {
  RustNeuronDiagnostic,
  RustSynapseDiagnostic,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

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
  focusList: number[],
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly number[]) => string,
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
      ? `${entry.id} (weight ${entry.weight.toFixed(4)})`
      : String(entry.id)
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
  focusList: number[],
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly number[]) => string,
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
  focusList: number[],
  reason: string,
  lastFocusSelection: FocusSelectionSummary | undefined,
  focusSelectionKeyFn: (list: readonly number[]) => string,
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

// Forward declaration - imported dynamically to avoid circular deps
import {
  formatNeuronDiagnostic,
  formatSynapseDiagnostic,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDiagnosticFormatting.ts";
import {
  describeNeuronDiagnosticReason,
  describeSynapseDiagnosticReason,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDiagnosticFormatting.ts";

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
              typeof (detail as import("./RustDiscovery.ts").RustSynapseDiagnosticDetail)
                  .suggestedWeight === "number")
            ? (detail as import("./RustDiscovery.ts").RustSynapseDiagnosticDetail)
              .suggestedWeight
            : undefined) ??
            (("outgoingWeight" in detail &&
                typeof (detail as import("./RustDiscovery.ts").RustNeuronDiagnosticDetail)
                    .outgoingWeight === "number")
              ? (detail as import("./RustDiscovery.ts").RustNeuronDiagnosticDetail)
                .outgoingWeight
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
