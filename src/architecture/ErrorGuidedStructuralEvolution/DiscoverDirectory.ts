/**
 * Barrel re-export for discovery directory operations.
 *
 * This module re-exports all public discovery directory functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export {
  calculateDiscoveryCandidateSummaryCounts,
  ensureWasmActivationForDiscovery,
  recordDirectory,
} from "@architecture/ErrorGuidedStructuralEvolution/DataRecorder.ts";

export type { DiscoveryPerformanceSummarySnapshot } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";

export { formatDiscoveryPerformanceSummary } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
