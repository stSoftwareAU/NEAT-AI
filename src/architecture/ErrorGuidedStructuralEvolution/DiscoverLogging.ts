/**
 * Barrel re-export for discovery logging and diagnostics.
 *
 * This module re-exports all logging functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export {
  formatMillis,
  isSynapseDiagnostic,
  logAnalysisSkipped,
  logDiscovery,
  logFocusSelectionDetails,
  logRustAnalysisUnavailable,
  logRustDiagnostics,
  logRustNoImprovement,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverLoggingCore.ts";

export {
  describeNeuronDiagnosticReason,
  describeSynapseDiagnosticReason,
  formatNeuronDiagnostic,
  formatSynapseDiagnostic,
  logHarmfulSynapse,
  logHelpfulNeuron,
  logHelpfulSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDiagnosticFormatting.ts";
