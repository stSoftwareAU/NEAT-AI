import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { Creature } from "../../Creature.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import type { DiscoverResult } from "./DiscoverResult.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
  type DiscoverStructureDeps,
} from "./DiscoverStructure.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructure.ts";
import { isRustDiscoveryEnabled } from "./RustDiscovery.ts";
import { PhaseDiagnostics } from "./PhaseDiagnostics.ts";

const shouldLogDiscovery = (options: NeatOptions): boolean =>
  Boolean(options.verbose || (options.log && options.log > 0));

/**
 * Tracks performance statistics throughout the discovery process.
 */
class DiscoveryPerformanceStats {
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

  // Candidate counts
  helpfulSynapseCandidates = 0;
  helpfulNeuronCandidates = 0;
  harmfulSynapseCandidates = 0;
  harmfulNeuronCandidates = 0;
  squashCandidates = 0;

  // Other phases
  cleanupTime = 0;
  totalTime = 0;

  /**
   * Logs a formatted performance summary when verbose mode is enabled.
   */
  logSummary(discoveryID: string, options: NeatOptions): void {
    if (!shouldLogDiscovery(options)) return;

    const formatTime = (ms: number) => format(ms, { ignoreZero: true });
    const formatCount = (count: number) =>
      yellow(count.toLocaleString("en-AU"));

    console.log(
      `\n${blue("=".repeat(60))}\n` +
        `${blue("Discovery Performance Summary")} ${blue(discoveryID)}\n` +
        `${blue("=".repeat(60))}`,
    );

    // Record phase summary
    console.log(
      `\n📊 ${yellow("Record Phase")}:\n` +
        `  Records processed: ${formatCount(this.recordsProcessed)}\n` +
        `  Files processed: ${formatCount(this.filesProcessed)}\n` +
        `  Initialization: ${formatTime(this.initializationTime)}\n` +
        `  File processing: ${formatTime(this.fileProcessingTime)}\n` +
        `  Promise wait: ${formatTime(this.promiseWaitTime)}\n` +
        `  Total record phase: ${formatTime(this.recordPhaseTime)}\n` +
        `  Records/sec: ${
          this.recordPhaseTime > 0
            ? formatCount(
              Math.round(
                (this.recordsProcessed / this.recordPhaseTime) * 1000,
              ),
            )
            : "n/a"
        }`,
    );

    // Analysis phase summary
    console.log(
      `\n🔍 ${yellow("Analysis Phase")}:\n` +
        `  Neurons analyzed: ${formatCount(this.neuronsAnalyzed)}\n` +
        `  Retry attempts: ${formatCount(this.retryAttempts)}\n` +
        `  Focus selection: ${formatTime(this.focusSelectionTime)}\n` +
        `  Rust combined analysis: ${
          formatTime(this.rustCombinedAnalysisTime)
        }\n` +
        `  Neuron analysis: ${formatTime(this.neuronAnalysisTime)}\n` +
        `  Synapse analysis: ${formatTime(this.synapseAnalysisTime)}\n` +
        `  Harmful synapse analysis: ${
          formatTime(this.harmfulSynapseAnalysisTime)
        }\n` +
        `  Harmful neuron analysis: ${
          formatTime(this.harmfulNeuronAnalysisTime)
        }\n` +
        `  Squash analysis: ${formatTime(this.squashAnalysisTime)}\n` +
        `  Total analysis phase: ${formatTime(this.analysisPhaseTime)}\n` +
        `  Neurons/sec: ${
          this.analysisPhaseTime > 0
            ? formatCount(
              Math.round(
                (this.neuronsAnalyzed / this.analysisPhaseTime) * 1000,
              ),
            )
            : "n/a"
        }`,
    );

    // Candidate summary
    console.log(
      `\n🎯 ${yellow("Candidates Found")}:\n` +
        `  Helpful synapses: ${formatCount(this.helpfulSynapseCandidates)}\n` +
        `  Helpful neurons: ${formatCount(this.helpfulNeuronCandidates)}\n` +
        `  Harmful synapses: ${formatCount(this.harmfulSynapseCandidates)}\n` +
        `  Harmful neurons: ${formatCount(this.harmfulNeuronCandidates)}\n` +
        `  Squash changes: ${formatCount(this.squashCandidates)}`,
    );

    // Overall summary
    // Note: Re-scoring time is not included here as it happens after recordDirectory returns
    // It is logged separately in DiscoveryRunner after re-scoring completes
    console.log(
      `\n⏱️  ${yellow("Overall")}:\n` +
        `  Cleanup: ${formatTime(this.cleanupTime)}\n` +
        `  Total time: ${formatTime(this.totalTime)}\n` +
        `${blue("=".repeat(60))}\n`,
    );
  }
}

export async function recordDirectory(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
  deps: Partial<DiscoverStructureDeps> = {},
) {
  const recorder = new DataRecorder(creature, options, deps);
  return await recorder.recordDirectory(dataDir);
}

class DataRecorder {
  private readonly BYTES_PER_RECORD: number;
  private readonly BATCH_SIZE: number;
  private readonly sampleRate: number;
  private readonly discoveryBatchSize: number;
  private readonly ID: string;
  private timeoutTS: number;
  private readonly timeoutSeconds: number;
  private readonly analysisTimeoutSeconds: number;
  private analysisDeadlineAt?: number;
  private readonly discoveryMaxNeurons: number;
  private readonly drainEveryNBatches: number;
  private readonly rustFlushRecords: number;
  private readonly discoverDeps: Partial<DiscoverStructureDeps>;

  constructor(
    private readonly creature: Creature,
    private readonly options: NeatOptions,
    deps: Partial<DiscoverStructureDeps>,
  ) {
    this.BYTES_PER_RECORD = (creature.input + creature.output) * 4;
    const discoveryBufferSize = options.discoveryBufferSize || 128 * 1024;
    this.BATCH_SIZE = Math.max(
      1,
      Math.floor(discoveryBufferSize / this.BYTES_PER_RECORD),
    );

    this.sampleRate = Math.min(
      1,
      Math.max(0.0001, options.discoverySampleRate!),
    );
    this.discoveryBatchSize = options.discoveryBatchSize || 512;

    this.ID = CreatureUtil.makeUUID(creature).slice(-8);

    const discoveryTimeOutMinutes = Math.min(
      60,
      options.discoveryTimeOutMinutes || 60,
    );
    assert(
      discoveryTimeOutMinutes > 0,
      "Discovery time out minutes must be greater than 0",
    );
    this.timeoutSeconds = discoveryTimeOutMinutes * 60;
    this.timeoutTS = Date.now() + this.timeoutSeconds * 1000;

    const analysisMinutesRaw = options.discoveryAnalysisTimeoutMinutes ??
      3;
    const analysisTimeoutMinutes = Math.min(60, analysisMinutesRaw);
    assert(
      analysisTimeoutMinutes > 0,
      "Discovery analysis timeout minutes must be greater than 0",
    );
    this.analysisTimeoutSeconds = analysisTimeoutMinutes * 60;

    this.discoveryMaxNeurons = Math.max(
      1,
      options.discoveryMaxNeurons || 6,
    );

    this.drainEveryNBatches = Math.max(
      1,
      options.discoveryDrainEveryNBatches ?? 10,
    );
    this.rustFlushRecords = Math.max(
      1,
      options.discoveryRustFlushRecords ?? DEFAULT_RUST_FLUSH_RECORDS,
    );
    this.discoverDeps = deps;
  }

  private shouldAwaitCleanup(): boolean {
    try {
      const explicit = Deno.env.get("NEAT_DISCOVERY_AWAIT_CLEANUP");
      if (explicit) {
        const normalized = explicit.trim().toLowerCase();
        return normalized === "1" || normalized === "true" ||
          normalized === "yes";
      }
      const denoTest = Deno.env.get("DENO_TEST");
      return denoTest?.toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  private shuffleFiles(files: string[]): string[] {
    for (let i = files.length; i--;) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
    return files;
  }

  private async getBinaryFiles(dataDir: string): Promise<string[]> {
    const binaryFiles: string[] = [];
    const entries = await Array.fromAsync(Deno.readDir(dataDir));

    for (const dirEntry of entries) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${dirEntry.name}`);
      }
    }

    return this.shuffleFiles(binaryFiles);
  }

  private fp(percentage: number): string {
    return yellow(
      Math.abs(1 - percentage) < Number.EPSILON
        ? "100%"
        : (percentage * 100).toFixed(1) + "%",
    );
  }

  async recordDirectory(dataDir: string): Promise<DiscoverResult> {
    // Check if Rust discovery module is available (library + GPU required)
    // Use dependency injection if provided, otherwise use the public function
    const rustEnabled = this.discoverDeps.isRustDiscoveryEnabled
      ? this.discoverDeps.isRustDiscoveryEnabled()
      : isRustDiscoveryEnabled();
    if (!rustEnabled) {
      if (shouldLogDiscovery(this.options)) {
        console.warn(
          `⚠️  Discovery skipped: Rust module or GPU not available. Discovery requires the NEAT-AI-Discovery Rust library to be built and available, and a GPU to be present.`,
        );
      }
      // Return empty result - discovery is skipped
      return {
        ID: this.ID,
        addHelpfulSynapses: undefined,
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        candidateSquashes: undefined,
      };
    }

    const binaryFiles = await this.getBinaryFiles(dataDir);
    assert(
      binaryFiles.length > 0,
      "No binary files found in the data directory",
    );

    return await this.recordFiles(binaryFiles);
  }

  private async processFile(
    filePath: string,
    discoverStructure: DiscoverStructure,
    params: {
      counter: { count: number };
      dataSet: DataRecordInterface[];
      neuronPromisesMap: Map<string, Promise<void>>;
      selectedIndices: number[]; // Track which record indices we sampled
      drainCounter: { count: number };
    },
  ) {
    const { creature } = this;
    let readTime = 0;
    const file = await Deno.open(filePath, { read: true });
    try {
      const stat = await file.stat();
      const fileRecords = stat.size / this.BYTES_PER_RECORD;
      const sampleSize = Math.ceil(fileRecords * this.sampleRate);

      // Generate random indexes and sort them for efficient seeking
      const tmpIndexes = Int32Array.from({ length: fileRecords }, (_, i) => i);
      CreatureUtil.shuffle(tmpIndexes);
      const selectedIndexes = tmpIndexes.slice(0, sampleSize).sort((a, b) =>
        a - b
      );

      // Reusable record buffer to avoid repeated allocations
      const recordBuffer = new Uint8Array(this.BYTES_PER_RECORD);
      const recordArray = new Float32Array(recordBuffer.buffer);

      for (const recordIndex of selectedIndexes) {
        if (this.timeoutTS && Date.now() > this.timeoutTS) break;

        // Calculate the target position
        const targetPosition = recordIndex * this.BYTES_PER_RECORD;

        // Seek to the specific record from beginning (simpler and more reliable)
        file.seekSync(targetPosition, Deno.SeekMode.Start);

        // Read the single record
        const readStartTime = Date.now();
        const bytesRead = file.readSync(recordBuffer);
        readTime += Date.now() - readStartTime;

        if (bytesRead === null || bytesRead !== this.BYTES_PER_RECORD) {
          console.warn(
            `Failed to read complete record at index ${recordIndex}`,
          );
          continue;
        }

        params.counter.count++;

        // Track which record index we sampled for this file
        params.selectedIndices.push(recordIndex);

        // Reuse Float32Array views instead of creating new arrays
        const data: DataRecordInterface = {
          input: new Float32Array(
            recordArray.subarray(0, creature.input),
          ),
          output: new Float32Array(
            recordArray.subarray(creature.input),
          ),
        };
        params.dataSet.push(data);

        if (params.dataSet.length >= this.discoveryBatchSize) {
          const recorded = discoverStructure.record(
            params.dataSet.splice(0),
            params.neuronPromisesMap,
            filePath,
            params.selectedIndices.splice(0), // Pass and clear indices
          );
          if (!recorded) break;
          assert(params.dataSet.length === 0, "Data set not empty");
          assert(params.selectedIndices.length === 0, "Indices not empty");

          // Increment drain counter
          params.drainCounter.count++;

          // Drain promises periodically to prevent unbounded chain growth
          if (params.drainCounter.count >= this.drainEveryNBatches) {
            // deno-lint-ignore no-await-in-loop
            await Promise.all(params.neuronPromisesMap.values());
            // Reset all promises to resolved state to break chains
            for (const uuid of params.neuronPromisesMap.keys()) {
              params.neuronPromisesMap.set(uuid, Promise.resolve());
            }
            params.drainCounter.count = 0;

            if (shouldLogDiscovery(this.options)) {
              console.log(
                `Discovery ${
                  blue(this.ID)
                } drained promises after ${this.drainEveryNBatches} batches`,
              );
            }
          }

          if (discoverStructure.shouldFlushRustChunk()) {
            const flushed = discoverStructure.flushRustChunk();
            if (!flushed) {
              console.warn(
                `⚠️  Discovery ${
                  blue(this.ID)
                } failed to flush discovery chunk after batch.`,
              );
            }
          }

          // Give GC a chance to run periodically
          // deno-lint-ignore no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // Clear large arrays to help GC
      // Note: TypedArray.length is read-only, so we can't clear them directly
      // The arrays will be garbage collected when they go out of scope
    } finally {
      file.close();
    }
  }

  private async recordFiles(binaryFiles: string[]): Promise<DiscoverResult> {
    const { creature, options } = this;
    const startTime = Date.now();
    const phaseDiagnostics = new PhaseDiagnostics("initialization");
    const perfStats = new DiscoveryPerformanceStats();

    if (shouldLogDiscovery(options)) {
      console.info(
        `Discovery ${
          blue(this.ID)
        } with ${binaryFiles.length} binary files, sample rate: ${
          this.fp(this.sampleRate)
        }, batch size: ${
          yellow(this.discoveryBatchSize.toLocaleString("en-AU"))
        }`,
      );
    }

    const discoverStructure = new DiscoverStructure(
      creature,
      this.timeoutSeconds,
      this.rustFlushRecords,
      this.discoverDeps,
    );
    discoverStructure.configureLogging({
      discoveryID: this.ID,
      verbose: shouldLogDiscovery(options),
    });
    const focusOverride = this.options.discoveryFocusNeuronUUIDs;
    if (Array.isArray(focusOverride) && focusOverride.length > 0) {
      discoverStructure.setForcedFocusNeurons(focusOverride);
    }
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    const initializeStartTime = Date.now();
    discoverStructure.initialize(neuronPromisesMap);
    const initializeTime = Date.now() - initializeStartTime;
    perfStats.initializationTime = initializeTime;

    // Declare timing variables outside try block for error diagnostics
    let fileProcessTime = 0;

    if (shouldLogDiscovery(options)) {
      console.log(
        `Discovery ${blue(this.ID)} initialize time ${
          yellow(format(initializeTime, { ignoreZero: true }))
        }`,
      );
    }
    try {
      const counter = { count: 0 };
      const drainCounter = { count: 0 };

      const dataSet: DataRecordInterface[] = [];
      const selectedIndices: number[] = [];

      phaseDiagnostics.enterPhase("file_processing");
      const fileProcessStartTime = Date.now();
      perfStats.filesProcessed = 0;
      for (const filePath of binaryFiles) {
        // deno-lint-ignore no-await-in-loop
        await this.processFile(filePath, discoverStructure, {
          counter,
          dataSet,
          neuronPromisesMap: neuronPromisesMap,
          selectedIndices,
          drainCounter,
        });

        // Flush any remaining data for this file to ensure indices are correctly associated
        if (dataSet.length > 0) {
          discoverStructure.record(
            dataSet.splice(0),
            neuronPromisesMap,
            filePath,
            selectedIndices.splice(0),
          );
          assert(dataSet.length === 0, "Data set not empty after flush");
          assert(
            selectedIndices.length === 0,
            "Indices not empty after flush",
          );
          if (discoverStructure.shouldFlushRustChunk()) {
            const flushed = discoverStructure.flushRustChunk();
            if (!flushed) {
              console.warn(
                `⚠️  Discovery ${
                  blue(this.ID)
                } failed to flush discovery chunk after file ${filePath}.`,
              );
            }
          }
        }

        // Drain promises after each file to limit memory usage
        // deno-lint-ignore no-await-in-loop
        await Promise.all(neuronPromisesMap.values());
        // Reset all promises to resolved state
        for (const uuid of neuronPromisesMap.keys()) {
          neuronPromisesMap.set(uuid, Promise.resolve());
        }
        drainCounter.count = 0; // Reset drain counter after file
        perfStats.filesProcessed++;

        if (this.timeoutTS && Date.now() > this.timeoutTS) {
          if (shouldLogDiscovery(this.options)) {
            console.warn(
              `⏲  Discovery ${
                blue(this.ID)
              } timeout reached during file processing. ` +
                `Processed ${counter.count} records. Proceeding with partial results for analysis.`,
            );
          }
          break;
        }
      }
      fileProcessTime = Date.now() - fileProcessStartTime;
      perfStats.fileProcessingTime = fileProcessTime;
      perfStats.recordsProcessed = counter.count;

      // All data has been flushed per-file, so dataSet should be empty
      assert(dataSet.length === 0, "Data set should be empty after processing");
      assert(
        selectedIndices.length === 0,
        "Indices should be empty after processing",
      );

      const scannedTime = Date.now() - startTime;
      if (shouldLogDiscovery(options)) {
        console.log(
          `Discovery ${blue(this.ID)} scanning time ${
            yellow(format(scannedTime, { ignoreZero: true }))
          }`,
        );
      }

      // Wait for all pending writes to complete
      phaseDiagnostics.enterPhase("promise_wait");
      const WRITE_TIMEOUT_MS = 60000; // 60 seconds for all writes
      const promiseWaitStartTime = Date.now();

      let timeoutId: number | undefined;
      try {
        // Create a timeout promise with clearable timer
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `Discovery ${this.ID} file writes timed out after ${WRITE_TIMEOUT_MS}ms`,
              ),
            );
          }, WRITE_TIMEOUT_MS);
        });

        // Race between all writes completing and timeout
        await Promise.race([
          Promise.all(neuronPromisesMap.values()),
          timeoutPromise,
        ]);
      } catch (error) {
        console.error(
          `❌ DISCOVERY WRITE ERROR for ${blue(this.ID)}:`,
          error,
        );
        throw error;
      } finally {
        // Always clear timeout to prevent resource leak
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
      perfStats.promiseWaitTime = Date.now() - promiseWaitStartTime;

      // Clear map to help GC
      neuronPromisesMap.clear();

      // Flush Rust recording if we were using Rust
      const rustFlushSuccess = discoverStructure.flushRustRecording();
      if (!rustFlushSuccess) {
        // Rust recording failed - return empty result (discovery skipped)
        if (shouldLogDiscovery(options)) {
          console.warn(
            `⚠️  Discovery ${
              blue(this.ID)
            }: Rust recording failed, discovery skipped.`,
          );
        }
        return {
          ID: this.ID,
          addHelpfulSynapses: undefined,
          addHelpfulNeurons: undefined,
          removeHarmfulSynapse: undefined,
          removeHarmfulNeurons: undefined,
          candidateSquashes: undefined,
        };
      }

      const recordPhaseEndTime = Date.now();
      perfStats.recordPhaseTime = recordPhaseEndTime - startTime;

      if (shouldLogDiscovery(options)) {
        console.log(
          `Discovery ${blue(this.ID)} recorded time ${
            yellow(format(perfStats.recordPhaseTime, { ignoreZero: true }))
          }`,
        );
      }

      // Extend timeout for analysis phase - give it dedicated time regardless of recording duration
      // This ensures analysis isn't starved if recording takes a long time
      const analysisTimeoutSeconds = this.analysisTimeoutSeconds;
      const analysisTimeoutMinutes = analysisTimeoutSeconds / 60;
      const analysisDeadlineAt = Date.now() + analysisTimeoutSeconds * 1000;
      this.analysisDeadlineAt = analysisDeadlineAt;
      discoverStructure.extendTimeoutForAnalysis(analysisTimeoutSeconds);
      this.timeoutTS = analysisDeadlineAt;

      if (shouldLogDiscovery(options)) {
        console.log(
          `Discovery ${blue(this.ID)} analysis timeout extended by ${
            yellow(analysisTimeoutMinutes.toString())
          }m`,
        );
      }

      const discoverResult: DiscoverResult = {
        ID: this.ID,
        addHelpfulSynapses: undefined,
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        candidateSquashes: undefined,
      };

      // Track attempted neurons to avoid re-analyzing the same ones
      const attemptedNeurons = new Set<string>();
      let retryAttempt = 0;
      const maxRetries = 10; // Reasonable limit to prevent infinite loops

      // Retry loop: try different neurons if no candidates found and time remains
      // Sequential execution is intentional - we check results after each attempt
      const analysisPhaseStartTime = Date.now();
      while (retryAttempt <= maxRetries) {
        const focusSelectStart = Date.now();
        // deno-lint-ignore no-await-in-loop
        const focusList = await discoverStructure.selectNeuronsWeightedByError(
          this.discoveryMaxNeurons,
          retryAttempt > 0 ? retryAttempt : undefined,
          this.options.costOfGrowth,
        );
        perfStats.focusSelectionTime += Date.now() - focusSelectStart;

        // Filter out neurons we've already tried
        const newFocusList = focusList.filter((uuid) =>
          !attemptedNeurons.has(uuid)
        );

        if (shouldLogDiscovery(options)) {
          const selectTime = Date.now() - focusSelectStart;
          const retryMsg = retryAttempt > 0
            ? ` (retry ${retryAttempt}, ${attemptedNeurons.size} already tried)`
            : "";
          console.log(
            `Discovery ${blue(this.ID)} selected ${
              yellow(newFocusList.length.toString())
            } focus neuron${newFocusList.length === 1 ? "" : "s"} in ${
              yellow(format(selectTime, { ignoreZero: true }))
            }${retryMsg}`,
          );
        }

        // Mark these neurons as attempted
        newFocusList.forEach((uuid) => attemptedNeurons.add(uuid));
        perfStats.neuronsAnalyzed += newFocusList.length;

        // If we have no new neurons to try, stop retrying
        if (newFocusList.length === 0) {
          if (shouldLogDiscovery(options)) {
            console.log(
              `Discovery ${
                blue(this.ID)
              } no new neurons to analyze, stopping retry loop`,
            );
          }
          break;
        }

        const rustAnalysisStart = Date.now();
        const combinedResult = discoverStructure.ensureRustCombinedAnalysis(
          newFocusList,
          true, // includeSynapse
          true, // includeNeuron
        );
        const rustAnalysisTime = Date.now() - rustAnalysisStart;
        perfStats.rustCombinedAnalysisTime += rustAnalysisTime;
        if (combinedResult) {
          this.refreshAnalysisTimeout(discoverStructure);
        }

        phaseDiagnostics.enterPhase("analysis_parallel");
        let addHelpfulNeurons: CandidateNeuron[] | undefined;
        let addHelpfulSynapse: CandidateSynapse[] | undefined;
        let removeHarmfulSynapse: CandidateSynapse | undefined;
        let removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined;
        let candidateSquashes: CandidateSquash[] | undefined;

        const parallelStartTime = Date.now();
        const candidateBundle = discoverStructure.collectRustAnalysisCandidates(
          newFocusList,
        );
        const candidateCollectionTime = Date.now() - parallelStartTime;
        // Note: candidateCollectionTime is just data collection, actual analysis was timed earlier

        if (candidateBundle) {
          phaseDiagnostics.enterPhase("analysis_loop");
          addHelpfulSynapse = candidateBundle.helpfulSynapses;
          removeHarmfulSynapse = candidateBundle.harmfulSynapse;
          addHelpfulNeurons = candidateBundle.helpfulNeurons;
          this.refreshAnalysisTimeout(discoverStructure);

          if (shouldLogDiscovery(options)) {
            const helpfulSynapseCount = addHelpfulSynapse?.length ?? 0;
            const helpfulNeuronCount = addHelpfulNeurons?.length ?? 0;
            const harmfulCount = removeHarmfulSynapse ? 1 : 0;
            console.log(
              `Discovery ${blue(this.ID)} candidate collection ${
                yellow(format(candidateCollectionTime, {
                  ignoreZero: true,
                }))
              } synapse candidates: ${helpfulSynapseCount}, neuron candidates: ${helpfulNeuronCount}, harmful removals: ${harmfulCount}`,
            );
          }

          const squashStartTime = Date.now();
          // deno-lint-ignore no-await-in-loop
          candidateSquashes = await discoverStructure
            .analyzeSelectedNeuronsSquashes(newFocusList);
          this.refreshAnalysisTimeout(discoverStructure);
          const squashTime = Date.now() - squashStartTime;
          perfStats.squashAnalysisTime += squashTime;
          if (shouldLogDiscovery(options)) {
            const squashCount = candidateSquashes?.length ?? 0;
            let squashSummaryText = "";
            if (squashCount > 0 && candidateSquashes) {
              const squashSummary = candidateSquashes.map((candidate) => {
                return `${candidate.neuronUUID} ${candidate.previousSquash} -> ${candidate.squash} improved: ${
                  (candidate.expectedImprovementPercentage * 100).toFixed(1)
                }% error: ${candidate.currentError.toFixed(4)} -> ${
                  candidate.improvedError.toFixed(4)
                }`;
              });
              squashSummaryText = `, Summary: ${squashSummary.join(",")}`;
            }
            console.log(
              `Discovery ${blue(this.ID)} analyze squashes time ${
                yellow(format(squashTime, { ignoreZero: true }))
              } found ${squashCount} candidate${
                squashCount === 1 ? "" : "s"
              }${squashSummaryText}`,
            );
          }
        } else {
          const runAnalysisPhase = <T>(
            label: string,
            executor: () => Promise<T>,
          ): Promise<T> => {
            const stopTracking = phaseDiagnostics.startParallelPhase(label);
            return executor()
              .finally(() => {
                stopTracking();
              });
          };

          const neuronPromise = runAnalysisPhase(
            "analyze_neurons",
            async () => {
              const neuronAnalyzeStart = Date.now();
              const helpfulNeurons = await discoverStructure
                .analyzeMissingNeurons(
                  newFocusList,
                );
              this.refreshAnalysisTimeout(discoverStructure);
              const neuronAnalyzeTime = Date.now() - neuronAnalyzeStart;
              perfStats.neuronAnalysisTime += neuronAnalyzeTime;
              if (shouldLogDiscovery(options)) {
                console.log(
                  `Discovery ${blue(this.ID)} analyze neurons time ${
                    yellow(format(neuronAnalyzeTime, { ignoreZero: true }))
                  } found ${
                    helpfulNeurons ? helpfulNeurons.length : 0
                  } neuron candidates`,
                );
              }
              return helpfulNeurons;
            },
          );

          const synapsePromise = runAnalysisPhase(
            "analyze_helpful",
            async () => {
              const analyzeStartTime = Date.now();
              const helpfulSynapses = await discoverStructure
                .analyzeSelectedNeurons(
                  newFocusList,
                );
              this.refreshAnalysisTimeout(discoverStructure);
              const analyzeTime = Date.now() - analyzeStartTime;
              perfStats.synapseAnalysisTime += analyzeTime;
              if (shouldLogDiscovery(options)) {
                console.log(
                  `Discovery ${blue(this.ID)} analyze synapses time ${
                    yellow(format(analyzeTime, { ignoreZero: true }))
                  } found ${
                    helpfulSynapses ? helpfulSynapses.length : 0
                  } candidate${
                    helpfulSynapses && helpfulSynapses.length === 1 ? "" : "s"
                  }`,
                );
              }
              return helpfulSynapses;
            },
          );

          const harmfulPromise = runAnalysisPhase(
            "analyze_harmful",
            async () => {
              const harmfulStartTime = Date.now();
              const harmfulSynapse = await discoverStructure
                .analyzeSelectedNeuronsForRemoval(newFocusList);
              this.refreshAnalysisTimeout(discoverStructure);
              const harmfulTime = Date.now() - harmfulStartTime;
              perfStats.harmfulSynapseAnalysisTime += harmfulTime;
              if (shouldLogDiscovery(options)) {
                console.log(
                  `Discovery ${blue(this.ID)} analyze harmful time ${
                    yellow(format(harmfulTime, { ignoreZero: true }))
                  } found ${harmfulSynapse ? 1 : 0} candidates`,
                );
              }
              return harmfulSynapse;
            },
          );

          const squashPromise = runAnalysisPhase(
            "analyze_squash",
            async () => {
              const squashStartTime = Date.now();
              const squashes = await discoverStructure
                .analyzeSelectedNeuronsSquashes(newFocusList);
              this.refreshAnalysisTimeout(discoverStructure);
              const squashTime = Date.now() - squashStartTime;
              perfStats.squashAnalysisTime += squashTime;
              if (shouldLogDiscovery(options)) {
                const squashCount = squashes ? squashes.length : 0;
                let squashSummaryText = "";
                if (squashCount > 0 && squashes) {
                  const squashSummary = squashes.map((candidate) => {
                    return `${candidate.neuronUUID} ${candidate.previousSquash} -> ${candidate.squash} improved: ${
                      (candidate.expectedImprovementPercentage * 100).toFixed(
                        1,
                      )
                    }% error: ${candidate.currentError.toFixed(4)} -> ${
                      candidate.improvedError.toFixed(4)
                    }`;
                  });
                  squashSummaryText = `, Summary: ${squashSummary.join(",")}`;
                }
                console.log(
                  `Discovery ${blue(this.ID)} analyze squashes time ${
                    yellow(format(squashTime, { ignoreZero: true }))
                  } found ${squashCount} candidate${
                    squashCount === 1 ? "" : "s"
                  }${squashSummaryText}`,
                );
              }
              return squashes;
            },
          );

          const harmfulNeuronPromise = runAnalysisPhase(
            "analyze_harmful_neurons",
            async () => {
              const harmfulNeuronStartTime = Date.now();
              const harmfulNeurons = await discoverStructure
                .analyzeSelectedNeuronsForHarmfulRemoval(newFocusList);
              this.refreshAnalysisTimeout(discoverStructure);
              const harmfulNeuronTime = Date.now() - harmfulNeuronStartTime;
              perfStats.harmfulNeuronAnalysisTime += harmfulNeuronTime;
              if (shouldLogDiscovery(options)) {
                const harmfulNeuronCount = harmfulNeurons
                  ? harmfulNeurons.length
                  : 0;
                console.log(
                  `Discovery ${blue(this.ID)} analyze harmful neurons time ${
                    yellow(format(harmfulNeuronTime, { ignoreZero: true }))
                  } found ${harmfulNeuronCount} candidate${
                    harmfulNeuronCount === 1 ? "" : "s"
                  }`,
                );
              }
              return harmfulNeurons;
            },
          );

          const analysisPromises: [
            Promise<CandidateNeuron[] | undefined>,
            Promise<CandidateSynapse[] | undefined>,
            Promise<CandidateSynapse | undefined>,
            Promise<CandidateSquash[] | undefined>,
            Promise<CandidateHarmfulNeuron[] | undefined>,
          ] = [
            neuronPromise,
            synapsePromise,
            harmfulPromise,
            squashPromise,
            harmfulNeuronPromise,
          ];
          // deno-lint-ignore no-await-in-loop
          const analysisResults = await Promise.all(analysisPromises);
          phaseDiagnostics.enterPhase("analysis_loop");
          [
            addHelpfulNeurons,
            addHelpfulSynapse,
            removeHarmfulSynapse,
            candidateSquashes,
            removeHarmfulNeurons,
          ] = analysisResults;
        }

        if (addHelpfulNeurons && addHelpfulNeurons.length > 0) {
          discoverResult.addHelpfulNeurons = [
            ...(discoverResult.addHelpfulNeurons ?? []),
            ...addHelpfulNeurons,
          ];
          perfStats.helpfulNeuronCandidates += addHelpfulNeurons.length;
        }
        if (addHelpfulSynapse && addHelpfulSynapse.length > 0) {
          discoverResult.addHelpfulSynapses = [
            ...(discoverResult.addHelpfulSynapses ?? []),
            ...addHelpfulSynapse,
          ];
          perfStats.helpfulSynapseCandidates += addHelpfulSynapse.length;
        }
        if (removeHarmfulSynapse && !discoverResult.removeHarmfulSynapse) {
          discoverResult.removeHarmfulSynapse = removeHarmfulSynapse;
          perfStats.harmfulSynapseCandidates = 1;
        }
        if (candidateSquashes && candidateSquashes.length > 0) {
          discoverResult.candidateSquashes = [
            ...(discoverResult.candidateSquashes ?? []),
            ...candidateSquashes,
          ];
          perfStats.squashCandidates += candidateSquashes.length;
        }
        if (removeHarmfulNeurons && removeHarmfulNeurons.length > 0) {
          discoverResult.removeHarmfulNeurons = [
            ...(discoverResult.removeHarmfulNeurons ?? []),
            ...removeHarmfulNeurons,
          ];
          perfStats.harmfulNeuronCandidates += removeHarmfulNeurons.length;
        }

        // Check if we found any candidates
        const foundCandidates = Boolean(
          discoverResult.addHelpfulSynapses ||
            discoverResult.addHelpfulNeurons ||
            discoverResult.removeHarmfulSynapse ||
            discoverResult.removeHarmfulNeurons ||
            discoverResult.candidateSquashes,
        );
        if (foundCandidates && shouldLogDiscovery(options)) {
          console.log(
            `Discovery ${
              blue(this.ID)
            } accumulated candidate updates; continuing search while time remains.`,
          );
        }

        const timeRemaining = this.timeoutTS - Date.now();
        if (timeRemaining <= 0) {
          if (shouldLogDiscovery(options)) {
            console.log(
              `Discovery ${
                blue(this.ID)
              } analysis timeout reached after evaluating ${attemptedNeurons.size} neuron(s)`,
            );
          }
          break;
        }

        perfStats.retryAttempts = retryAttempt;
        retryAttempt++;
        if (shouldLogDiscovery(options)) {
          console.log(
            `Discovery ${blue(this.ID)} retrying with different neurons (${
              yellow(format(timeRemaining, { ignoreZero: true }))
            } remaining, retry ${retryAttempt})`,
          );
        }
      }
      perfStats.analysisPhaseTime = Date.now() - analysisPhaseStartTime;

      phaseDiagnostics.enterPhase("complete");
      if (shouldLogDiscovery(options)) {
        const totalTime = Date.now() - startTime;
        console.log(
          `Discovery ${blue(this.ID)} analysis complete, total time ${
            yellow(format(totalTime, { ignoreZero: true }))
          }, starting cleanup...`,
        );
      }

      // Schedule cleanup to happen asynchronously without blocking the response
      // This prevents slow filesystem operations from delaying the discovery result
      // Must be scheduled after analysis loop completes to avoid race conditions
      const cleanupStartTime = Date.now();
      const cleanupPromise = (async () => {
        if (shouldLogDiscovery(options)) {
          console.log(`Discovery ${blue(this.ID)} performing cleanup...`);
        }
        await discoverStructure.cleanUp();
        perfStats.cleanupTime = Date.now() - cleanupStartTime;
        if (shouldLogDiscovery(options)) {
          console.log(`Discovery ${blue(this.ID)} cleanup complete.`);
        }
      })();

      if (this.shouldAwaitCleanup()) {
        await cleanupPromise;
        if (shouldLogDiscovery(options)) {
          console.log(
            `Discovery ${blue(this.ID)} cleanup awaited and complete (${
              format(perfStats.cleanupTime, { ignoreZero: true })
            }).`,
          );
        }
      } else {
        // Don't await cleanup - let it happen in the background
        // Catch any errors to prevent unhandled rejections and resource leaks
        cleanupPromise.catch((error) => {
          console.error(
            `❌ CRITICAL: Discovery ${this.ID} cleanup failed - potential resource leak:`,
            error,
          );
        });
        if (shouldLogDiscovery(options)) {
          console.log(
            `Discovery ${
              blue(this.ID)
            } cleanup scheduled (async, non-blocking - results will be returned immediately).`,
          );
        }
        // If cleanup is async, we can't measure it accurately, so set to 0
        // The actual cleanup time will be logged when it completes
        perfStats.cleanupTime = 0;
      }

      // Calculate total time after conditional await to include cleanup when awaited
      perfStats.totalTime = Date.now() - startTime;

      // Note: reScoringTime is not included in the performance summary as it happens
      // after recordDirectory returns. It is logged separately in DiscoveryRunner
      // after re-scoring completes.
      perfStats.logSummary(this.ID, options);

      return discoverResult;
    } catch (error) {
      // On error, show diagnostics unconditionally (indicates a bug)
      const totalTime = Date.now() - startTime;
      console.error(
        `❌ DISCOVERY ERROR for ${blue(this.ID)} after ${
          format(totalTime, { ignoreZero: true })
        }:`,
      );
      console.error(`   Error: ${error}`);
      const phaseSnapshot = phaseDiagnostics.snapshot();
      console.error(`   Current phase: ${phaseSnapshot.currentPhase}`);
      if (phaseSnapshot.parallelPhases.length > 0) {
        console.error(
          `   Active analysis phases: ${
            phaseSnapshot.parallelPhases.join(", ")
          }`,
        );
      }
      console.error(`   Phase timing diagnostics:`);
      console.error(
        `     - Initialize: ${format(initializeTime, { ignoreZero: true })}`,
      );
      console.error(
        `     - File processing: ${
          format(fileProcessTime, { ignoreZero: true })
        }`,
      );
      console.error(`     - Total: ${format(totalTime, { ignoreZero: true })}`);

      if (shouldLogDiscovery(options)) {
        console.log(
          `Discovery ${blue(this.ID)} error occurred, performing cleanup...`,
        );
      }
      try {
        await discoverStructure.cleanUp();
        if (shouldLogDiscovery(options)) {
          console.log(`Discovery ${blue(this.ID)} cleanup complete.`);
        }
      } catch (cleanupError) {
        console.error(
          `❌ WARNING: Discovery ${this.ID} cleanup failed after error:`,
          cleanupError,
        );
        // Don't throw - preserve the original error
      }
      throw error;
    }
  }

  private refreshAnalysisTimeout(
    discoverStructure: DiscoverStructure,
  ): void {
    if (this.analysisDeadlineAt === undefined) {
      return;
    }
    const remainingMs = this.analysisDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      return;
    }
    const remainingSeconds = Math.max(1, Math.floor(remainingMs / 1000));
    discoverStructure.extendTimeoutForAnalysis(remainingSeconds);
    this.timeoutTS = this.analysisDeadlineAt;
  }
}
