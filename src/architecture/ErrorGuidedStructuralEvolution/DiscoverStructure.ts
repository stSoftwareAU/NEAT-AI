/**
 * Error-Driven Structural Discovery coordinator.
 *
 * Issue #1472: Refactored from ~3,857 lines into focused modules.
 * Issue #1597: Further split into inheritance chain:
 *   DiscoverStructureBase → Recording → Analysis → DiscoverStructure
 *
 * This file acts as the final facade/coordinator that extends the
 * analysis layer with static application delegates and type re-exports.
 *
 * @see docs/DISCOVERY_GUIDE.md for complete workflow documentation
 */

import type { Creature } from "../../Creature.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructureTypes.ts";
import {
  addHelpfulNeurons as addHelpfulNeuronsImpl,
  addHelpfulSynapses as addHelpfulSynapsesImpl,
  changeSquash as changeSquashImpl,
  getRemovalSameUUIDCount as getRemovalSameUUIDCountImpl,
  recordDiscoveryIssue as recordDiscoveryIssueImpl,
  removeHarmfulNeuron as removeHarmfulNeuronImpl,
  removeLowImpactNeuron as removeLowImpactNeuronImpl,
  removeSynapse as removeSynapseImpl,
  resetRemovalDiagnostics as resetRemovalDiagnosticsImpl,
  validateAndFixIfNeeded as validateAndFixIfNeededImpl,
} from "./DiscoveryApplication.ts";
import { DiscoverStructureAnalysis } from "./DiscoverStructureAnalysis.ts";

export {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "./constants.ts";

// Re-export all types from DiscoverStructureTypes for backward compatibility
export type {
  BinaryRecordIndices,
  CandidateAnalysisBundle,
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
  DiscoverRecord,
  DiscoverStructureOptions,
  FocusSelectionSummaryEntry,
  LowImpactNeuron,
  NeuronErrorInfo,
  NeuronImpactInfo,
  NeuronScanStats,
  NeuronStats,
  RustFlushAggregation,
  RustFlushDiagnostics,
  RustFlushMetrics,
} from "./DiscoverStructureTypes.ts";
export type {
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
} from "./DiscoverStructureTypes.ts";

export type { DiscoverStructureDeps } from "./DiscoverStructureBase.ts";

/**
 * Implements Error-Driven Structural Discovery, analysing neuron activations and errors
 * to identify beneficial structural changes (new synapses, neuron removal, activation changes).
 *
 * Designed for continuous incremental improvement through repeated runs across multiple machines.
 * Typical improvements are 0.5-3% per iteration, compounding over time.
 *
 * @see docs/DISCOVERY_GUIDE.md for complete workflow documentation
 */
export class DiscoverStructure extends DiscoverStructureAnalysis {
  // ── Static application delegates ────────────────────────────────────

  private static validateAndFixIfNeeded(
    creature: Creature,
    originalCreature: Creature,
    discoveryID: string,
    operationType: string,
    candidate: unknown,
    discoveryFailureCacheDir?: string,
  ): { success: boolean; fixWasCalled: boolean; validationError?: Error } {
    return validateAndFixIfNeededImpl(
      creature,
      originalCreature,
      discoveryID,
      operationType,
      candidate,
      discoveryFailureCacheDir,
    );
  }

  private static recordDiscoveryIssue(
    originalCreature: Creature,
    discoveryID: string,
    operationType: string,
    issueType: string,
    details: unknown,
    discoveryFailureCacheDir: string,
  ): void {
    recordDiscoveryIssueImpl(
      originalCreature,
      discoveryID,
      operationType,
      issueType,
      details,
      discoveryFailureCacheDir,
    );
  }

  public static removeSynapse(
    ID: string,
    creature: Creature,
    worseCandidate?: CandidateSynapse,
    discoveryFailureCacheDir?: string,
  ): Creature | null {
    return removeSynapseImpl(
      ID,
      creature,
      worseCandidate,
      discoveryFailureCacheDir,
    );
  }

  public static addHelpfulSynapses(
    ID: string,
    creature: Creature,
    helpfulSynapses?: CandidateSynapse[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return addHelpfulSynapsesImpl(
      ID,
      creature,
      helpfulSynapses,
      discoveryFailureCacheDir,
    );
  }

  public static addHelpfulNeurons(
    ID: string,
    creature: Creature,
    helpfulNeurons?: CandidateNeuron[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return addHelpfulNeuronsImpl(
      ID,
      creature,
      helpfulNeurons,
      discoveryFailureCacheDir,
    );
  }

  public static changeSquash(
    ID: string,
    creature: Creature,
    helpfulSquashes?: CandidateSquash[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return changeSquashImpl(
      ID,
      creature,
      helpfulSquashes,
      discoveryFailureCacheDir,
    );
  }

  public static removeHarmfulNeuron(
    ID: string,
    creature: Creature,
    harmfulNeuron?: CandidateHarmfulNeuron,
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return removeHarmfulNeuronImpl(
      ID,
      creature,
      harmfulNeuron,
      discoveryFailureCacheDir,
    );
  }

  public static removeLowImpactNeuron(
    ID: string,
    creature: Creature,
    removalCandidate?: import("./DiscoverResult.ts").RemovalCandidate,
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return removeLowImpactNeuronImpl(
      ID,
      creature,
      removalCandidate,
      discoveryFailureCacheDir,
    );
  }

  public static resetRemovalDiagnostics(): void {
    resetRemovalDiagnosticsImpl();
  }

  public static getRemovalSameUUIDCount(): number {
    return getRemovalSameUUIDCountImpl();
  }

  public getRemovalCandidates():
    | import("./DiscoverResult.ts").RemovalCandidate[]
    | undefined {
    return this.cachedRemovalCandidates;
  }
}
