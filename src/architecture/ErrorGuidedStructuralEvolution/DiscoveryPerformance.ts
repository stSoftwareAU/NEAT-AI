/**
 * Performance tracking and formatting for discovery operations.
 *
 * Contains the performance statistics class, snapshot interface,
 * and formatted summary output used by the DataRecorder.
 */

import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Returns whether discovery logging is enabled for the given config.
 */
export const shouldLogDiscovery = (config: NeatConfig): boolean =>
  config.verbose || config.log > 0;

/**
 * Clamps non-finite values to zero for safe formatting.
 */
export function msOrZero(ms: number): number {
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Tracks performance statistics throughout the discovery process.
 */
export class DiscoveryPerformanceStats {
  // Record phase stats
  recordsProcessed = 0;
  filesProcessed = 0;
  recordPhaseTime = 0;
  initializationTime = 0;
  fileProcessingTime = 0;
  promiseWaitTime = 0;

  // Analysis phase stats
  neuronsAnalyzed = 0;
  retryAttempts = 0;
  analysisPhaseTime = 0;
  focusSelectionTime = 0;
  rustCombinedAnalysisTime = 0;
  neuronAnalysisTime = 0;
  synapseAnalysisTime = 0;
  harmfulSynapseAnalysisTime = 0;
  harmfulNeuronAnalysisTime = 0;
  squashAnalysisTime = 0;
  /**
   * Set to true when the analysis loop aborted early due to a throughput
   * stall (a single Rust combined-analysis chunk exceeded the per-chunk
   * budget). See Issue #2380.
   */
  analysisStalled = false;

  // Candidate counts (final arrays returned to the caller).
  // Note (29-Dec-2025): Counts are taken from the result arrays (not per-retry
  // accumulation) so logs match what downstream consumers will actually see.
  helpfulSynapseCount = 0;
  helpfulNeuronCount = 0;
  coordinatedStructuralCount = 0;
  harmfulSynapseCount = 0;
  harmfulNeuronCount = 0;
  squashCount = 0;
  removalCount = 0;

  // Other phases
  cleanupTime = 0;
  totalTime = 0;

  /**
   * Logs a formatted performance summary when verbose mode is enabled.
   */
  logSummary(discoveryID: string, config: NeatConfig): void {
    if (!shouldLogDiscovery(config)) return;

    getLogger().info(
      formatDiscoveryPerformanceSummary(
        discoveryID,
        {
          // Record phase
          recordsProcessed: this.recordsProcessed,
          filesProcessed: this.filesProcessed,
          recordPhaseTime: this.recordPhaseTime,
          initializationTime: this.initializationTime,
          fileProcessingTime: this.fileProcessingTime,
          promiseWaitTime: this.promiseWaitTime,

          // Analysis phase
          neuronsAnalyzed: this.neuronsAnalyzed,
          retryAttempts: this.retryAttempts,
          analysisPhaseTime: this.analysisPhaseTime,
          focusSelectionTime: this.focusSelectionTime,
          rustCombinedAnalysisTime: this.rustCombinedAnalysisTime,
          neuronAnalysisTime: this.neuronAnalysisTime,
          synapseAnalysisTime: this.synapseAnalysisTime,
          harmfulSynapseAnalysisTime: this.harmfulSynapseAnalysisTime,
          harmfulNeuronAnalysisTime: this.harmfulNeuronAnalysisTime,
          squashAnalysisTime: this.squashAnalysisTime,

          // Candidate counts (counts match the arrays returned from recordDirectory()).
          helpfulSynapseCount: this.helpfulSynapseCount,
          helpfulNeuronCount: this.helpfulNeuronCount,
          coordinatedStructuralCount: this.coordinatedStructuralCount,
          harmfulSynapseCount: this.harmfulSynapseCount,
          harmfulNeuronCount: this.harmfulNeuronCount,
          squashCount: this.squashCount,
          removalCount: this.removalCount,

          // Other phases
          cleanupTime: this.cleanupTime,
          totalTime: this.totalTime,
        },
        { colour: true },
      ),
    );
  }
}

export interface DiscoveryPerformanceSummarySnapshot {
  // Record phase stats
  recordsProcessed: number;
  filesProcessed: number;
  recordPhaseTime: number;
  initializationTime: number;
  fileProcessingTime: number;
  promiseWaitTime: number;

  // Analysis phase stats
  neuronsAnalyzed: number;
  retryAttempts: number;
  analysisPhaseTime: number;
  focusSelectionTime: number;
  rustCombinedAnalysisTime: number;
  neuronAnalysisTime: number;
  synapseAnalysisTime: number;
  harmfulSynapseAnalysisTime: number;
  harmfulNeuronAnalysisTime: number;
  squashAnalysisTime: number;

  // Candidate counts (final arrays returned to the caller)
  helpfulSynapseCount: number;
  helpfulNeuronCount: number;
  coordinatedStructuralCount: number;
  harmfulSynapseCount: number;
  harmfulNeuronCount: number;
  squashCount: number;
  removalCount: number;

  // Other phases
  cleanupTime: number;
  totalTime: number;
}

export function formatDiscoveryPerformanceSummary(
  discoveryID: string,
  stats: DiscoveryPerformanceSummarySnapshot,
  options: { colour: boolean },
): string {
  const maybeBlue = (text: string) => options.colour ? blue(text) : text;
  const maybeYellow = (text: string) => options.colour ? yellow(text) : text;

  const formatCount = (count: number) =>
    maybeYellow(count.toLocaleString("en-AU"));

  const formatTotalTime = (ms: number): string =>
    format(msOrZero(ms), { ignoreZero: false });

  // Important: `format(ms, { ignoreZero: true })` returns an empty string for 0ms.
  // We treat that as "not recorded" and omit the line entirely to avoid confusing blank output.
  const formatNonZeroTimeLine = (
    label: string,
    ms: number,
  ): string | undefined => {
    const rendered = format(ms, { ignoreZero: true });
    if (!rendered) return undefined;
    return `  ${label}: ${rendered}`;
  };

  const recordLines: string[] = [
    `  Records processed: ${formatCount(stats.recordsProcessed)}`,
    `  Files processed: ${formatCount(stats.filesProcessed)}`,
    formatNonZeroTimeLine("Initialization", stats.initializationTime),
    formatNonZeroTimeLine("File processing", stats.fileProcessingTime),
    formatNonZeroTimeLine("Promise wait", stats.promiseWaitTime),
    `  Total record phase: ${formatTotalTime(stats.recordPhaseTime)}`,
    `  Records/sec: ${
      stats.recordPhaseTime > 0
        ? formatCount(
          Math.round((stats.recordsProcessed / stats.recordPhaseTime) * 1000),
        )
        : "n/a"
    }`,
  ].filter((line): line is string => Boolean(line));

  const analysisLines: string[] = [
    `  Neurons analyzed: ${formatCount(stats.neuronsAnalyzed)}`,
    `  Retry attempts: ${formatCount(stats.retryAttempts)}`,
    formatNonZeroTimeLine("Focus selection", stats.focusSelectionTime),
    formatNonZeroTimeLine(
      "Rust combined analysis",
      stats.rustCombinedAnalysisTime,
    ),
    formatNonZeroTimeLine("Neuron analysis", stats.neuronAnalysisTime),
    formatNonZeroTimeLine("Synapse analysis", stats.synapseAnalysisTime),
    formatNonZeroTimeLine(
      "Harmful synapse analysis",
      stats.harmfulSynapseAnalysisTime,
    ),
    formatNonZeroTimeLine(
      "Harmful neuron analysis",
      stats.harmfulNeuronAnalysisTime,
    ),
    formatNonZeroTimeLine("Squash analysis", stats.squashAnalysisTime),
    `  Total analysis phase: ${formatTotalTime(stats.analysisPhaseTime)}`,
    `  Neurons/sec: ${
      stats.analysisPhaseTime > 0
        ? formatCount(
          Math.round((stats.neuronsAnalyzed / stats.analysisPhaseTime) * 1000),
        )
        : "n/a"
    }`,
  ].filter((line): line is string => Boolean(line));

  const candidateLines: string[] = [
    `  Helpful synapses: ${formatCount(stats.helpfulSynapseCount)}`,
    `  Helpful neurons: ${formatCount(stats.helpfulNeuronCount)}`,
    `  Coordinated structural: ${
      formatCount(stats.coordinatedStructuralCount)
    }`,
    `  Harmful synapses: ${formatCount(stats.harmfulSynapseCount)}`,
    `  Harmful neurons: ${formatCount(stats.harmfulNeuronCount)}`,
    `  Squash changes: ${formatCount(stats.squashCount)}`,
    `  Removal candidates: ${formatCount(stats.removalCount)}`,
  ];

  const overallLines: string[] = [
    formatNonZeroTimeLine("Cleanup", stats.cleanupTime),
    `  Total time: ${formatTotalTime(stats.totalTime)}`,
  ].filter((line): line is string => Boolean(line));

  return (
    `\n${maybeBlue("=".repeat(60))}\n` +
    `${maybeBlue("Discovery Performance Summary")} ${
      maybeBlue(discoveryID)
    }\n` +
    `${maybeBlue("=".repeat(60))}` +
    `\n\n📊 ${maybeYellow("Record Phase")}:\n` +
    `${recordLines.join("\n")}` +
    `\n\n🔍 ${maybeYellow("Analysis Phase")}:\n` +
    `${analysisLines.join("\n")}` +
    `\n\n🎯 ${maybeYellow("Candidates Found")}:\n` +
    `${candidateLines.join("\n")}` +
    `\n\n⏱️  ${maybeYellow("Overall")}:\n` +
    `${overallLines.join("\n")}\n` +
    `${maybeBlue("=".repeat(60))}\n`
  );
}
