/**
 * Recording phase methods for DiscoverStructure.
 *
 * Extends DiscoverStructureBase with all recording, chunk management,
 * and flush methods for Rust-backed Parquet recording.
 */

import { assert } from "@std/assert";
import { dirname } from "@std/path";
import { DiscoveryError } from "@errors/DiscoveryError.ts";
import { WasmError } from "@errors/WasmError.ts";
import {
  creatureToRustFormat,
  type RustRecordBatchStats,
  type RustRecordInput,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  RustFlushAggregation,
  RustFlushDiagnostics,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import {
  computeRustFlushMetrics as computeRustFlushMetricsImpl,
  createRustFlushAggregation as createRustFlushAggregationImpl,
  finalizeRustFlushDiagnostics as finalizeRustFlushDiagnosticsImpl,
  observeRustTrainingRecord as observeRustTrainingRecordImpl,
} from "@architecture/ErrorGuidedStructuralEvolution/RustFlushDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import { appendAll } from "@utils/ArrayAppend.ts";
import { isReleased } from "@utils/ReleasableRef.ts";
import { DiscoverStructureBase } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureBase.ts";
import {
  checkDiskSpace,
  logDiscoveryDiskUsage,
} from "@discovery/DiskSpaceMonitor.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

/**
 * Adds recording, chunk management, and flush methods to the
 * DiscoverStructure coordinator.
 */
export class DiscoverStructureRecording extends DiscoverStructureBase {
  // ── Recording phase ─────────────────────────────────────────────────

  public record(
    trainingData: DataRecordInterface[],
    _neuronPromisesMap: Map<number, Promise<void>>,
    binaryFilePath?: string,
    recordIndices?: number[],
    options?: Readonly<{
      allowGraceAfterTimeout?: boolean;
    }>,
  ): boolean {
    assert(this.initialized, "Not initialized");
    const timedOut = Date.now() > this.timeoutTS;
    this.recorded = true;
    this.cachedMaxOutputError = undefined;

    assert(
      this.usingRustDualWrite,
      "Discovery recording requires Rust discovery to be enabled.",
    );

    let effectiveTrainingData = trainingData;
    let effectiveRecordIndices = recordIndices;
    if (timedOut) {
      const hasAnyRecordedSoFar = this.rustChunkFiles.length > 0 ||
        this.rustAccumulatedData.length > 0;
      if (hasAnyRecordedSoFar) {
        this.log(
          "warn",
          "Discovery recording timeout reached; skipping remaining samples.",
        );
        return false;
      }

      if (!options?.allowGraceAfterTimeout) {
        this.log(
          "warn",
          "Discovery recording timeout reached; skipping remaining samples.",
        );
        return false;
      }

      const MAX_GRACE_SAMPLES = 64;
      const take = Math.min(effectiveTrainingData.length, MAX_GRACE_SAMPLES);
      if (take <= 0) {
        return false;
      }
      if (take < effectiveTrainingData.length) {
        this.log(
          "warn",
          `Discovery recording timeout reached; capturing a small grace batch (${take}/${effectiveTrainingData.length}) to avoid empty artefacts.`,
        );
      } else {
        this.log(
          "warn",
          `Discovery recording timeout reached; capturing ${take} grace sample(s) to avoid empty artefacts.`,
        );
      }

      effectiveTrainingData = effectiveTrainingData.slice(0, take);
      if (effectiveRecordIndices) {
        effectiveRecordIndices = effectiveRecordIndices.slice(0, take);
      }
    }

    if (
      binaryFilePath && effectiveRecordIndices &&
      effectiveRecordIndices.length > 0
    ) {
      if (!this.selectedIndices[binaryFilePath]) {
        this.selectedIndices[binaryFilePath] = [];
      }
      // Issue #2900: stack-safe append; a batch holds up to discoveryBatchSize
      // indices (config, no hard upper cap), so spreading risks RangeError.
      appendAll(this.selectedIndices[binaryFilePath], effectiveRecordIndices);

      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      if (!this.rustBinaryFilePath) {
        this.rustBinaryFilePath = binaryFilePath;
      }
      this.rustBinaryFilePaths.add(binaryFilePath);
    }

    for (let i = 0; i < effectiveTrainingData.length; i++) {
      const record = effectiveTrainingData[i];
      try {
        this.assertWasmActivation();

        const traceAll = {
          traceNeeded: (_id: number) => true,
          propagateNeeded: (_id: number) => true,
          updateNeeded: (_id: number) => true,
        };
        this.creature.activateAndTrace(
          record.input,
          false,
          traceAll,
        );
        const discoverMap = this.creature.record(record.output);

        this.rustAccumulatedData.push(record);
        this.rustAccumulatedNeuronData.push(discoverMap);
        this.rustAccumulatedEstimatedBytes += this.rustEstimatedBytesPerSample;

        for (const [id, rec] of discoverMap) {
          let sumAbs = 0;
          for (const err of rec.errors) {
            if (Number.isFinite(err)) {
              sumAbs += Math.abs(err);
            }
          }
          if (sumAbs > 0) {
            const prev = this.recordedNeuronTotalAbsError.get(id) ?? 0;
            this.recordedNeuronTotalAbsError.set(id, prev + sumAbs);
          } else if (!this.recordedNeuronTotalAbsError.has(id)) {
            this.recordedNeuronTotalAbsError.set(id, 0);
          }
        }
      } catch (error) {
        // Issue #2483: A WASM compile/activate failure here means the
        // creature is unfit for discovery — drop it gracefully instead
        // of letting `RuntimeError: unreachable` bubble out of recording
        // and kill the surrounding worker. The WasmCompilationCache has
        // already logged once for this creature uuid.
        if (error instanceof WasmError) {
          getLogger().warn(
            `Discovery ${this.discoveryID} dropping creature ${
              this.creature.uuid ?? "(no-uuid)"
            } at sample ${
              i + 1
            }/${trainingData.length} after WASM activation failed: ${error.message}`,
          );
          break;
        }
        if (
          error instanceof Error && error.message.includes("Excessive record()")
        ) {
          getLogger().error(
            `❌ Error occurred while processing sample ${
              i + 1
            }/${trainingData.length}`,
          );
          getLogger().error(
            `   Total samples accumulated so far: ${this.rustAccumulatedData.length}`,
          );
          getLogger().error(`   Input: ${record.input.slice(0, 5)}...`);
          getLogger().error(`   Output: ${record.output.slice(0, 5)}...`);
        }
        throw error;
      }
    }

    return !timedOut;
  }

  public shouldFlushRustChunk(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );
    if (this.rustAccumulatedData.length >= this.rustFlushRecords) return true;
    return this.rustAccumulatedEstimatedBytes >= this.rustFlushBytesThreshold;
  }

  private getNextChunkDir(): string {
    const index = ++this.rustChunkCounter;
    const dir = `${this.tempDir}/chunks/chunk-${
      index.toString().padStart(5, "0")
    }`;
    try {
      Deno.mkdirSync(dir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
    return dir;
  }

  private writeRustParquetChunk(tempDir: string): string | null {
    // Issue #2398: creature may have been released by cleanUp() — the
    // field is typed as non-nullable but is cleared to null for GC.
    if (isReleased(this, "creature")) {
      getLogger().warn(
        `⚠️  Discovery recording skipped: creature has been cleaned up.`,
      );
      return null;
    }

    if (!this.deps.isRustLibraryAvailable()) {
      getLogger().warn(
        `⚠️  Rust library not available when flushing. Discovery recording failed.`,
      );
      return null;
    }

    this.creature.validate();

    const creatureExport = this.creature.exportJSON();
    const rustCreature = creatureToRustFormat(creatureExport);
    const pendingSamples = this.rustAccumulatedData.length;

    const nonInputNeurons = this.creature.neurons.filter((neuron) =>
      neuron.type !== "input"
    );

    const rustTrainingData = this.rustAccumulatedData.map((record, index) => {
      const discoverMap = this.rustAccumulatedNeuronData[index];

      const neuronData = nonInputNeurons.map((neuron) => {
        const discoverRecord = discoverMap.get(neuron.id) || {
          activation: this.creature.state.activations[neuron.index],
          errors: [] as number[],
        };

        const errors = discoverRecord.errors.filter(Number.isFinite);

        return {
          neuron_uuid: neuronUuid(neuron),
          activation: discoverRecord.activation,
          value: discoverRecord.value,
          errors: errors,
        };
      });

      return {
        input: Array.from(record.input),
        output: Array.from(record.output),
        neuron_data: neuronData,
      };
    });

    const diagnostics = this.inspectRustFlushBatch(
      rustTrainingData,
      this.creature.input,
      this.creature.output,
      nonInputNeurons.length,
    );
    const metrics = diagnostics.metrics;

    let recordIndicesLocal: number[] | undefined = undefined;
    if (this.rustBinaryFilePaths.size === 1 && this.rustBinaryFilePath) {
      const fileIndices = this.selectedIndices[this.rustBinaryFilePath];
      if (fileIndices && fileIndices.length >= pendingSamples) {
        const recentIndices = fileIndices.slice(-pendingSamples);
        recordIndicesLocal = recentIndices.slice();
      }
    }

    const now = Date.now();
    const timedOut = now > this.timeoutTS;
    if (timedOut) {
      this.log(
        "warn",
        "Submitting flush request to Rust after recording timeout expired. Continuing with captured data.",
      );
    }

    this.emitRustFlushDiagnostics(diagnostics, timedOut);

    const timeoutSeconds = timedOut
      ? 0
      : Math.max(0, Math.floor((this.timeoutTS - now) / 1000));

    const rustInput: RustRecordInput = {
      creature: rustCreature,
      "training_data": rustTrainingData,
      "temp_dir": tempDir,
      "binary_file_path": this.rustBinaryFilePath || undefined,
      "record_indices": recordIndicesLocal,
      "timeout_seconds": timeoutSeconds,
      taskDescriptor: this.taskDescriptor,
    };

    const result = this.deps.recordDiscovery(rustInput);

    if (result && result.success && result.file) {
      const parquetPath = `${tempDir}/${result.file}`;

      if (this.syntheticBinaryMode || this.rustBinaryFilePaths.size === 0) {
        this.syntheticBinaryMode = true;
        const tempBinaryFile = `${tempDir}/training_data.bin`;
        const BYTES_PER_RECORD = (this.creature.input + this.creature.output) *
          4;
        const file = Deno.openSync(tempBinaryFile, {
          create: true,
          write: true,
          truncate: true,
        });

        try {
          const buffer = new Uint8Array(BYTES_PER_RECORD);
          const recordArray = new Float32Array(buffer.buffer);
          const sequentialIndices: number[] = [];

          for (let i = 0; i < this.rustAccumulatedData.length; i++) {
            const localRecord = this.rustAccumulatedData[i];
            for (let j = 0; j < this.creature.input; j++) {
              recordArray[j] = localRecord.input[j];
            }
            for (let j = 0; j < this.creature.output; j++) {
              recordArray[this.creature.input + j] = localRecord.output[j];
            }
            file.writeSync(buffer);
            sequentialIndices.push(i);
          }

          this.selectedIndices[tempBinaryFile] = sequentialIndices;
          this.rustBinaryFilePaths.add(tempBinaryFile);
          if (!this.rustBinaryFilePath) {
            this.rustBinaryFilePath = tempBinaryFile;
          }
        } finally {
          file.close();
        }
      }

      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      this.rustAccumulatedData = [];
      this.rustAccumulatedNeuronData = [];
      this.rustAccumulatedEstimatedBytes = 0;

      return parquetPath;
    }

    const errorMessage = result?.error || "Unknown error";
    const errorDetails = result?.errorDetails;
    const logDetails: Record<string, unknown> = {
      pendingSamples,
      timeoutExpired: timedOut,
      binaryFilePath: this.rustBinaryFilePath,
      forcedFocusNeurons: this.forcedFocusNeurons,
      accumulatedSamples: this.rustAccumulatedData.length,
      chunkFiles: this.rustChunkFiles.length,
      longestRustUuidLength: metrics.longestNeuronUuidLength,
      totalRustUuidBytes: metrics.totalNeuronUuidBytes,
      maxRustErrorsPerNeuron: metrics.maxErrorValuesPerNeuron,
      totalRustErrorValues: metrics.totalErrorValues,
      rustRecordCount: metrics.sampleCount,
    };
    if (metrics.longestNeuronUuid && metrics.longestNeuronUuidLength > 0) {
      logDetails.longestRustUuid = metrics.longestNeuronUuid;
    }
    if (metrics.inputLength !== undefined) {
      logDetails.rustInputLength = metrics.inputLength;
    }
    if (metrics.outputLength !== undefined) {
      logDetails.rustOutputLength = metrics.outputLength;
    }
    if (errorDetails) {
      logDetails.rustRecordFailureStage = errorDetails.stage;
      if (errorDetails.inputJsonLength !== undefined) {
        logDetails.rustInputJsonLength = errorDetails.inputJsonLength;
      }
      if (errorDetails.inputBytesLength !== undefined) {
        logDetails.rustInputBytes = errorDetails.inputBytesLength;
      }
      logDetails.recordDiscoveryStats = errorDetails.stats;
    }
    this.log(
      "error",
      `Rust discovery recording failed: ${errorMessage}`,
      logDetails,
    );
    return null;
  }

  public flushRustChunk(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );
    if (this.rustAccumulatedData.length === 0) {
      return false;
    }

    try {
      // Issue #1703: Runtime disk space check before writing a chunk
      const diskCheck = checkDiskSpace(this.tempDir, 100);
      if (!diskCheck.ok) {
        getLogger().error(
          `[Discovery] ${diskCheck.message} Aborting chunk flush to prevent I/O failure.`,
        );
        return false;
      }

      const chunkDir = this.getNextChunkDir();
      const parquetPath = this.writeRustParquetChunk(chunkDir);
      if (!parquetPath) {
        return false;
      }
      this.rustChunkFiles.push(parquetPath);
      return true;
    } catch (error) {
      getLogger().error("❌ Failed to flush discovery chunk:", error);
      return false;
    }
  }

  public flushRustRecording(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );

    if (this.rustAccumulatedData.length > 0) {
      if (!this.flushRustChunk()) {
        return false;
      }
    }

    if (this.rustChunkFiles.length === 0) {
      this.parquetFilePath = null;
      this.combinedRustAnalysis = undefined;
      return true;
    }

    if (!this.deps.isRustLibraryAvailable()) {
      throw new DiscoveryError(
        "Rust discovery library must be available when merging discovery chunks.",
        "LIBRARY_NOT_FOUND",
      );
    }

    const outputFile = `${this.tempDir}/discovery_data.parquet`;
    const chunkFilesToCleanup = [...this.rustChunkFiles];
    const mergeResult = this.deps.mergeDiscoveryParquet({
      outputFile,
      inputFiles: [...this.rustChunkFiles],
    });

    if (!mergeResult || !mergeResult.success) {
      getLogger().error(
        "❌ Rust discovery merge failed:",
        mergeResult?.error ?? "Unknown error",
      );
      return false;
    }

    this.parquetFilePath = mergeResult.outputFile ?? outputFile;
    this.combinedRustAnalysis = undefined;
    this.rustChunkFiles = [];

    // Issue #1703: Log disk usage after recording phase
    logDiscoveryDiskUsage(this.tempDir, "after recording");

    if (!this.disableCleanup) {
      for (const file of chunkFilesToCleanup) {
        try {
          Deno.removeSync(file);
        } catch {
          // Ignore cleanup failures
        }
        try {
          Deno.removeSync(dirname(file), { recursive: true });
        } catch {
          // Ignore directory cleanup failures
        }
      }
    }
    return true;
  }

  // ── Flush diagnostics ──────────────────────────────────────────────

  public static computeRustFlushMetrics(
    data: RustRecordInput["training_data"],
    expectedNeuronCount: number,
    expectedInputLength: number,
    expectedOutputLength: number,
  ): RustRecordBatchStats {
    return computeRustFlushMetricsImpl(
      data,
      expectedNeuronCount,
      expectedInputLength,
      expectedOutputLength,
    );
  }

  private emitRustFlushDiagnostics(
    diagnostics: RustFlushDiagnostics,
    _timedOut: boolean,
  ): void {
    diagnostics.warnings.forEach((warning) => this.log("warn", warning));
    diagnostics.errors.forEach((error) => this.log("error", error));
  }

  private createRustFlushAggregation(
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushAggregation {
    return createRustFlushAggregationImpl(
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
    );
  }

  private observeRustTrainingRecord(
    aggregation: RustFlushAggregation,
    record: RustRecordInput["training_data"][number],
    globalSampleIndex: number,
  ): void {
    observeRustTrainingRecordImpl(aggregation, record, globalSampleIndex);
  }

  private finalizeRustFlushDiagnostics(
    aggregation: RustFlushAggregation,
  ): RustFlushDiagnostics {
    return finalizeRustFlushDiagnosticsImpl(
      aggregation,
      (value, max) => this.truncateForLog(value, max),
    );
  }

  private inspectRustFlushBatch(
    rustTrainingData: RustRecordInput["training_data"],
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushDiagnostics {
    const aggregation = this.createRustFlushAggregation(
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
    );
    rustTrainingData.forEach((record, recordIndex) => {
      this.observeRustTrainingRecord(aggregation, record, recordIndex);
    });
    return this.finalizeRustFlushDiagnostics(aggregation);
  }
}
