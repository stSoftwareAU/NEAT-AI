/**
 * Analysis phase methods for DiscoverStructure.
 *
 * Extends DiscoverStructureRecording with all neuron/synapse analysis,
 * squash analysis, harmful removal analysis, and Rust analysis cache
 * integration.
 */

import type {
  CandidateAnalysisBundle,
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
  DiscoverRecord,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import type {
  RustAnalyzeAllResult,
  RustCandidateNeuron,
  RustCandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import {
  collectRustAnalysisCandidates as collectRustAnalysisCandidatesImpl,
  filterTopNeuronCandidates,
  mapRustCandidate as mapRustCandidateImpl,
  mapRustNeuronCandidate as mapRustNeuronCandidateImpl,
  tryRustHarmfulCandidates,
  tryRustHelpfulNeurons,
  tryRustHelpfulSynapses,
  upsertDiscovery,
  upsertNeuronDiscovery,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverAnalysis.ts";
import {
  ensureRustCombinedAnalysis as ensureRustCombinedAnalysisImpl,
  readRustCombinedAnalysis as readRustCombinedAnalysisImpl,
} from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import {
  analyzeSelectedNeuronsForHarmfulRemoval as analyzeHarmfulNeuronsImpl,
  findCandidateSquash as findCandidateSquashImpl,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { assert } from "@std/assert";
import type { NeuronErrorInfo } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import {
  focusSelectionKey,
  listViableNeurons,
  selectNeuronsWeightedByError as selectNeuronsWeightedByErrorImpl,
  updateFocusSelectionSummary,
} from "@architecture/ErrorGuidedStructuralEvolution/FocusSelection.ts";
import {
  formatMillis,
  logAnalysisSkipped,
  logFocusSelectionDetails as logFocusSelectionDetailsImpl,
  logHarmfulSynapse,
  logHelpfulNeuron,
  logHelpfulSynapse,
  logRustAnalysisUnavailable as logRustAnalysisUnavailableImpl,
  logRustNoImprovement as logRustNoImprovementImpl,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverLogging.ts";
import { DiscoverStructureRecording } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureRecording.ts";
import {
  buildRuntimeIdToWireMap,
  resolveRuntimeIdToWireUuid,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";

/**
 * Adds analysis methods to the DiscoverStructure coordinator.
 *
 * Extends the recording layer with synapse analysis, neuron analysis,
 * squash analysis, harmful neuron detection, and Rust combined analysis
 * cache management.
 */
export class DiscoverStructureAnalysis extends DiscoverStructureRecording {
  // ── Focus selection (delegates) ─────────────────────────────────────

  public listViableNeurons(
    targetCount?: number,
  ): NeuronErrorInfo[] {
    const result = listViableNeurons(
      this.creature,
      this.recorded,
      this.parquetFilePath,
      this.deps,
      this.loggingEnabled,
      this.discoveryID,
      this.recordedNeuronTotalAbsError,
      (uuid) => this.calculateNeuronImpact(uuid),
      (level, message, details) => this.log(level, message, details),
      targetCount,
    );
    if (result.scanStats) {
      this.lastNeuronScanStats = result.scanStats;
    }
    if (result.cachedMaxOutputError) {
      this.cachedMaxOutputError = result.cachedMaxOutputError;
    }
    if (result.removalCandidates) {
      this.cachedRemovalCandidates = result.removalCandidates;
    }
    return result.neurons;
  }

  public async selectNeuronsWeightedByError(
    count: number,
    costOfGrowth: number,
    retryNumber?: number,
    mode: "add" | "remove" = "add",
  ): Promise<number[]> {
    assert(count > 0, "Count must be greater than 0");
    this.lastFocusSelection = undefined;

    if (
      this.forcedFocusNeurons && this.forcedFocusIndex <
        this.forcedFocusNeurons.length
    ) {
      const nextIndex = Math.min(
        this.forcedFocusIndex + count,
        this.forcedFocusNeurons.length,
      );
      const trimmed = this.forcedFocusNeurons.slice(
        this.forcedFocusIndex,
        nextIndex,
      );
      this.forcedFocusIndex = nextIndex;
      if (this.loggingEnabled) {
        this.log(
          "info",
          `Serving ${trimmed.length} forced focus neuron(s) (${this.forcedFocusIndex}/${this.forcedFocusNeurons.length} consumed).`,
        );
      }
      if (this.forcedFocusIndex >= this.forcedFocusNeurons.length) {
        if (this.loggingEnabled) {
          this.log(
            "info",
            "All forced focus neurons evaluated; falling back to weighted selection.",
          );
        }
        this.forcedFocusNeurons = null;
      }
      if (trimmed.length > 0) {
        this.lastFocusSelection = updateFocusSelectionSummary(
          this.loggingEnabled,
          this.discoveryID,
          "forced",
          trimmed,
          (level, message, details) => this.log(level, message, details),
          undefined,
          undefined,
          "forced focus override",
        );
        return trimmed;
      }
    }

    const listViableStart = Date.now();
    const allNeuronErrors = this.listViableNeurons(count);
    const listViableTime = Date.now() - listViableStart;
    if (allNeuronErrors.length === 0) return [];

    const maxErrorStart = Date.now();
    const result = await selectNeuronsWeightedByErrorImpl(
      count,
      costOfGrowth,
      allNeuronErrors,
      () => this.getMaxOutputError(),
      this.loggingEnabled,
      this.discoveryID,
      this.tempDir,
      (level, message, details) => this.log(level, message, details),
      retryNumber,
      mode,
    );
    const maxErrorTime = Date.now() - maxErrorStart;

    this.lastFocusSelection = result.focusSelection;

    // Log timing breakdown if either phase took significant time
    if (this.loggingEnabled && (listViableTime > 100 || maxErrorTime > 100)) {
      this.log(
        "debug",
        `Focus selection breakdown: listViableNeurons=${
          formatMillis(listViableTime)
        }, weightedSelection=${formatMillis(maxErrorTime)}`,
      );
    }

    return result.selected;
  }

  // ── Rust analysis cache (delegates) ─────────────────────────────────

  public ensureRustCombinedAnalysis(
    focusList: number[],
    includeSynapse: boolean,
    includeNeuron: boolean,
    /**
     * Optional tighter per-chunk deadline (Issue #2501). Forwarded to Rust
     * via `RustParallelAnalysisInput.analysisDeadlineMs` so the synchronous
     * FFI call self-aborts close to the per-chunk budget instead of running
     * for the full analysis window.
     */
    chunkDeadlineMs?: number,
  ): RustAnalyzeAllResult | undefined {
    const result = ensureRustCombinedAnalysisImpl(
      this.creature,
      this.parquetFilePath,
      this.deps,
      this.combinedRustAnalysis,
      this.analysisDeadlineMs,
      focusList,
      includeSynapse,
      includeNeuron,
      (scope, fl, reason) => this.logRustAnalysisUnavailable(scope, fl, reason),
      chunkDeadlineMs,
    );
    this.combinedRustAnalysis = result.cache;
    return result.result;
  }

  // ── Analysis logging helpers ────────────────────────────────────────

  protected logRustAnalysisUnavailable(
    scope: "synapse" | "neuron",
    focusList: number[],
    reason: string,
  ): void {
    logRustAnalysisUnavailableImpl(
      this.loggingEnabled,
      this.discoveryID,
      scope,
      focusList,
      reason,
      this.lastFocusSelection,
      focusSelectionKey,
    );
  }

  protected logRustNoImprovement(
    scope: "synapse" | "neuron",
    focusList: number[],
    diagnostics?:
      | import("./RustDiscovery.ts").RustSynapseDiagnostic[]
      | import("./RustDiscovery.ts").RustNeuronDiagnostic[],
  ): void {
    logRustNoImprovementImpl(
      this.loggingEnabled,
      this.discoveryID,
      scope,
      focusList,
      this.lastFocusSelection,
      focusSelectionKey,
      diagnostics,
    );
  }

  // ── Analysis (delegates) ────────────────────────────────────────────

  // deno-lint-ignore require-await
  public async analyzeSelectedNeurons(
    focusList: number[],
  ): Promise<CandidateSynapse[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeSelectedNeurons");
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      true,
      false,
    );
    const rustCandidates = tryRustHelpfulSynapses(
      rustResult,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    rustCandidates.forEach((candidate) =>
      upsertDiscovery(this.discoveries, candidate)
    );
    const topCandidate = rustCandidates[0];
    logHelpfulSynapse(this.loggingEnabled, this.discoveryID, topCandidate);
    return Promise.resolve(this.discoveries);
  }

  // deno-lint-ignore require-await
  public async analyzeMissingNeurons(
    focusList: number[],
  ): Promise<CandidateNeuron[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeMissingNeurons");
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "neuron",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    this.ensureRustCombinedAnalysis(focusList, false, true);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      false,
      true,
    );
    const rustCandidates = tryRustHelpfulNeurons(
      rustResult,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "neuron",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    const bestCandidates = filterTopNeuronCandidates(rustCandidates);
    bestCandidates.forEach((candidate) => {
      upsertNeuronDiscovery(this.neuronDiscoveries, candidate);
      logHelpfulNeuron(this.loggingEnabled, this.discoveryID, candidate);
    });
    return Promise.resolve(bestCandidates);
  }

  public collectRustAnalysisCandidates(
    focusList: number[],
  ): CandidateAnalysisBundle | undefined {
    const combinedResult = this.ensureRustCombinedAnalysis(
      focusList,
      true,
      true,
    );
    return collectRustAnalysisCandidatesImpl(
      combinedResult,
      focusList,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
  }

  public async analyze(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSynapse[] | undefined> {
    if (this.recorded === false) {
      this.log("warn", "No recorded data to analyze.");
      return undefined;
    }
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
    );
    return this.analyzeSelectedNeurons(focusList);
  }

  // ── Synapse removal (delegates) ─────────────────────────────────────

  public analyzeSelectedNeuronsForRemoval(
    focusList: number[],
  ): Promise<CandidateSynapse | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForRemoval",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      true,
      false,
    );
    const rustCandidates = tryRustHarmfulCandidates(rustResult);
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    const worstCandidate = rustCandidates[0];
    logHarmfulSynapse(this.loggingEnabled, this.discoveryID, worstCandidate);
    return Promise.resolve(worstCandidate);
  }

  async analyzeSynapsesForRemoval(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSynapse | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
      undefined,
      "remove",
    );
    return this.analyzeSelectedNeuronsForRemoval(focusList);
  }

  // ── Squash analysis (delegates) ─────────────────────────────────────

  async analyzeNeuronsSquashes(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSquash[] | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
    );
    return this.analyzeSelectedNeuronsSquashes(focusList);
  }

  public async analyzeSelectedNeuronsSquashes(
    focusList: number[],
    /**
     * Issue #2483: Optional sink for neurons whose error magnitude exceeds
     * `MAX_REASONABLE_SQUASH_ERROR`. When supplied, the squash analyser will
     * push a `CandidateHarmfulNeuron` for each over-threshold neuron, so the
     * surrounding pipeline routes them through `removeHarmfulNeuron`
     * instead of merely logging "this neuron should be removed".
     */
    harmfulSink?: CandidateHarmfulNeuron[],
  ): Promise<CandidateSquash[] | undefined> {
    if (focusList.length === 0) return undefined;

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsSquashes",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return undefined;
    }

    const idToWire = buildRuntimeIdToWireMap(this.creature);
    const candidatePromises = focusList.map(async (neuronId) => {
      const wireUuid = resolveRuntimeIdToWireUuid(idToWire, neuronId);
      if (!wireUuid) {
        if (this.loggingEnabled) {
          this.log(
            "warn",
            `Skipping squash analysis for neuron ${neuronId}: missing stable wire uuid`,
          );
        }
        return undefined;
      }
      const records = await this.loadNeuronRecords(
        `${this.tempDir}/${wireUuid}`,
      );
      return findCandidateSquashImpl(
        this.creature,
        neuronId,
        records,
        (id, derivativeMap) => this.calculateNeuronImpact(id, derivativeMap),
        this.loggingEnabled,
        (level, message, details) => this.log(level, message, details),
        harmfulSink,
      );
    });

    return await Promise.all(candidatePromises).then((candidates) => {
      return candidates.filter((candidate) => candidate !== undefined);
    });
  }

  // ── Harmful neuron analysis (delegates) ─────────────────────────────

  public async analyzeSelectedNeuronsForHarmfulRemoval(
    focusList: number[],
  ): Promise<CandidateHarmfulNeuron[] | undefined> {
    if (focusList.length === 0) return undefined;

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForHarmfulRemoval",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return undefined;
    }

    return await analyzeHarmfulNeuronsImpl(
      this.creature,
      focusList,
      (neuronIdentifier) => this.loadNeuronRecords(neuronIdentifier),
      this.tempDir,
      this.loggingEnabled,
      (level, message, details) => this.log(level, message, details),
    );
  }

  // ── Private delegates for backward-compatible instance access ───────

  private mapRustCandidate(
    candidate: RustCandidateSynapse,
  ): CandidateSynapse {
    return mapRustCandidateImpl(candidate);
  }

  private mapRustNeuronCandidate(
    candidate: RustCandidateNeuron,
  ): CandidateNeuron {
    return mapRustNeuronCandidateImpl(candidate);
  }

  private findCandidateSquash(
    neuronId: number,
    records: DiscoverRecord[],
  ): CandidateSquash | undefined {
    return findCandidateSquashImpl(
      this.creature,
      neuronId,
      records,
      (id, derivativeMap) => this.calculateNeuronImpact(id, derivativeMap),
      this.loggingEnabled,
      (level, message, details) => this.log(level, message, details),
    );
  }
}
