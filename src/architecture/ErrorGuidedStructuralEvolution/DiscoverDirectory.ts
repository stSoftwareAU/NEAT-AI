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
} from "./DataRecorder.ts";

export type { DiscoveryPerformanceSummarySnapshot } from "./DiscoveryPerformance.ts";

export { formatDiscoveryPerformanceSummary } from "./DiscoveryPerformance.ts";
