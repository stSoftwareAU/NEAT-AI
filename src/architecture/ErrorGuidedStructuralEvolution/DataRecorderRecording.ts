/**
 * Recording phase logic for the DataRecorder.
 *
 * Contains the file processing function and the recording phase orchestration,
 * extracted from the DataRecorder class to keep individual modules under ~500 lines.
 */

import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { NeatConfig } from "../../config/NeatConfig.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { shouldLogDiscovery } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import type { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import { submitDiscoveryRecordBatch } from "@architecture/ErrorGuidedStructuralEvolution/SubmitDiscoveryRecordBatch.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Context describing the DataRecorder state needed by processFile.
 */
export interface FileProcessingContext {
  readonly inputCount: number;
  readonly outputCount: number;
  readonly BYTES_PER_RECORD: number;
  readonly sampleRate: number;
  readonly discoveryBatchSize: number;
  readonly timeoutTS: number;
  readonly drainEveryNBatches: number;
  readonly config: NeatConfig;
  readonly ID: string;
}

/**
 * Processes a single binary data file, reading sampled records and submitting
 * them in batches to the discovery structure for recording.
 */
export async function processDiscoveryFile(
  ctx: FileProcessingContext,
  filePath: string,
  discoverStructure: DiscoverStructure,
  params: {
    counter: { count: number };
    dataSet: DataRecordInterface[];
    neuronPromisesMap: Map<number, Promise<void>>;
    selectedIndices: number[];
    drainCounter: { count: number };
  },
): Promise<void> {
  let readTime = 0;
  const file = await Deno.open(filePath, { read: true });
  try {
    const stat = await file.stat();
    const fileRecords = stat.size / ctx.BYTES_PER_RECORD;
    const sampleSize = Math.ceil(fileRecords * ctx.sampleRate);

    // Generate random indexes and sort them for efficient seeking
    const tmpIndexes = Int32Array.from({ length: fileRecords }, (_, i) => i);
    CreatureUtil.shuffle(tmpIndexes);
    const selectedIndexes = tmpIndexes.slice(0, sampleSize).sort((a, b) =>
      a - b
    );

    // Reusable record buffer to avoid repeated allocations
    const recordBuffer = new Uint8Array(ctx.BYTES_PER_RECORD);
    const recordArray = new Float32Array(recordBuffer.buffer);

    // Grace behaviour (24-Dec-2025): with very tight record deadlines (eg.
    // 60ms) and heavy CI load, the timeout can expire before we manage to read
    // even a single sample. That produces zero parquet artefacts and makes the
    // timeout tests flaky.
    //
    // If we have not recorded anything at all yet, allow a single "grace read"
    // of one record even when the timeout is already expired. The recorder
    // layer applies a matching opt-in grace for persisting that final sample.
    let usedGraceReadAfterTimeout = false;

    for (const recordIndex of selectedIndexes) {
      // If we're about to time out, flush any buffered samples as a partial
      // batch. This ensures we still persist useful work for large batch sizes
      // under tight record deadlines (eg. batch=512 with ~60ms timeout).
      if (ctx.timeoutTS) {
        const now = Date.now();
        const timeLeftMs = ctx.timeoutTS - now;
        if (timeLeftMs <= 0) {
          if (usedGraceReadAfterTimeout || params.counter.count > 0) break;
          usedGraceReadAfterTimeout = true;
        }

        // Keep this small: we just want to avoid crossing the deadline without
        // ever submitting a batch to the recorder.
        //
        // Note: 25ms is intentionally conservative. Under heavy CI load, a
        // 10ms window can be missed between loop iterations, which leads to
        // zero recorded Parquet artefacts even when we already buffered data.
        if (timeLeftMs <= 25 && params.dataSet.length > 0) {
          const recorded = submitDiscoveryRecordBatch(
            discoverStructure,
            params,
            filePath,
            { allowGraceAfterTimeout: true },
          );
          if (!recorded) break;
        }
      }

      // Calculate the target position
      const targetPosition = recordIndex * ctx.BYTES_PER_RECORD;

      // Seek to the specific record from beginning (simpler and more reliable)
      file.seekSync(targetPosition, Deno.SeekMode.Start);

      // Read the single record
      const readStartTime = Date.now();
      const bytesRead = file.readSync(recordBuffer);
      readTime += Date.now() - readStartTime;

      if (bytesRead === null || bytesRead !== ctx.BYTES_PER_RECORD) {
        getLogger().warn(
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
          recordArray.subarray(0, ctx.inputCount),
        ),
        output: new Float32Array(
          recordArray.subarray(ctx.inputCount),
        ),
      };
      params.dataSet.push(data);

      if (params.dataSet.length >= ctx.discoveryBatchSize) {
        const recorded = submitDiscoveryRecordBatch(
          discoverStructure,
          params,
          filePath,
          { allowGraceAfterTimeout: true },
        );
        if (!recorded) break;
        assert(params.dataSet.length === 0, "Data set not empty");
        assert(params.selectedIndices.length === 0, "Indices not empty");

        // Increment drain counter
        params.drainCounter.count++;

        // Drain promises periodically to prevent unbounded chain growth
        if (params.drainCounter.count >= ctx.drainEveryNBatches) {
          // deno-lint-ignore no-await-in-loop
          await Promise.all(params.neuronPromisesMap.values());
          // Reset all promises to resolved state to break chains
          for (const uuid of params.neuronPromisesMap.keys()) {
            params.neuronPromisesMap.set(uuid, Promise.resolve());
          }
          params.drainCounter.count = 0;

          if (shouldLogDiscovery(ctx.config)) {
            getLogger().info(
              `Discovery ${
                blue(ctx.ID)
              } drained promises after ${ctx.drainEveryNBatches} batches`,
            );
          }
        }

        if (discoverStructure.shouldFlushRustChunk()) {
          const flushed = discoverStructure.flushRustChunk();
          if (!flushed) {
            getLogger().warn(
              `⚠️  Discovery ${
                blue(ctx.ID)
              } failed to flush discovery chunk after batch.`,
            );
          }
        }

        // Give GC a chance to run periodically
        // deno-lint-ignore no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Flush any partial batch. This matters for short record timeouts and
    // large batch sizes (eg. 512) where we may not reach a full batch before
    // the deadline, but we still want to persist the data already buffered.
    if (params.dataSet.length > 0) {
      // Always attempt to submit the final partial batch. If the record window
      // expired a moment earlier, `DiscoverStructure.record()` may still accept
      // a small grace batch (to avoid losing all buffered work under tight
      // deadlines).
      const recorded = submitDiscoveryRecordBatch(
        discoverStructure,
        params,
        filePath,
        { allowGraceAfterTimeout: true },
      );

      // Best-effort flush of the Rust chunk after the final (partial) batch.
      // This keeps artefacts consistent when timeouts force partial recording.
      if (discoverStructure.shouldFlushRustChunk()) {
        const flushed = discoverStructure.flushRustChunk();
        if (!flushed) {
          getLogger().warn(
            `⚠️  Discovery ${
              blue(ctx.ID)
            } failed to flush discovery chunk after partial batch.`,
          );
        }
      }

      // If the recorder indicates we should stop (timeout), honour it.
      if (!recorded) {
        // No-op: exit function naturally.
      }
    }

    // Clear large arrays to help GC
    // Note: TypedArray.length is read-only, so we can't clear them directly
    // The arrays will be garbage collected when they go out of scope
  } finally {
    file.close();
  }
  // readTime is tracked but not currently surfaced in perf stats
  void readTime;
}

/**
 * Context describing the DataRecorder state needed by the recording phase.
 */
export interface RecordingPhaseContext extends FileProcessingContext {
  /** Current timeout timestamp for the recording phase. */
  readonly timeoutTS: number;
}

/**
 * Runs the recording phase: processes binary files and flushes Rust recording.
 * Returns false if Rust recording fails (caller should return empty result).
 */
export async function runRecordingPhase(
  ctx: RecordingPhaseContext,
  binaryFiles: string[],
  discoverStructure: DiscoverStructure,
  neuronPromisesMap: Map<number, Promise<void>>,
  phaseDiagnostics: PhaseDiagnostics,
  perfStats: DiscoveryPerformanceStats,
  startTime: number,
  skipRecording: boolean,
): Promise<boolean> {
  if (skipRecording) {
    if (shouldLogDiscovery(ctx.config)) {
      getLogger().info(
        `Discovery ${
          blue(ctx.ID)
        } skipping record phase - using existing parquet files from: ${discoverStructure.getTempDir()}`,
      );
    }
    perfStats.fileProcessingTime = 0;
    perfStats.recordsProcessed = 0;
    return true;
  }

  const counter = { count: 0 };
  const drainCounter = { count: 0 };
  const dataSet: DataRecordInterface[] = [];
  const selectedIndices: number[] = [];

  phaseDiagnostics.enterPhase("file_processing");
  const fileProcessStartTime = Date.now();
  perfStats.filesProcessed = 0;

  for (const filePath of binaryFiles) {
    // deno-lint-ignore no-await-in-loop
    await processDiscoveryFile(ctx, filePath, discoverStructure, {
      counter,
      dataSet,
      neuronPromisesMap,
      selectedIndices,
      drainCounter,
    });

    // Flush any remaining data for this file
    if (dataSet.length > 0) {
      const recorded = submitDiscoveryRecordBatch(
        discoverStructure,
        { dataSet, neuronPromisesMap, selectedIndices },
        filePath,
        { allowGraceAfterTimeout: true },
      );
      if (!recorded) {
        dataSet.length = 0;
        selectedIndices.length = 0;
        break;
      }
      assert(dataSet.length === 0, "Data set not empty after flush");
      assert(
        selectedIndices.length === 0,
        "Indices not empty after flush",
      );
      if (discoverStructure.shouldFlushRustChunk()) {
        const flushed = discoverStructure.flushRustChunk();
        if (!flushed) {
          getLogger().warn(
            `⚠️  Discovery ${
              blue(ctx.ID)
            } failed to flush discovery chunk after file ${filePath}.`,
          );
        }
      }
    }

    // Drain promises after each file to limit memory usage
    // deno-lint-ignore no-await-in-loop
    await Promise.all(neuronPromisesMap.values());
    for (const uuid of neuronPromisesMap.keys()) {
      neuronPromisesMap.set(uuid, Promise.resolve());
    }
    drainCounter.count = 0;
    perfStats.filesProcessed++;

    if (ctx.timeoutTS && Date.now() > ctx.timeoutTS) {
      if (shouldLogDiscovery(ctx.config)) {
        getLogger().warn(
          `⏲  Discovery ${
            blue(ctx.ID)
          } timeout reached during file processing. ` +
            `Processed ${counter.count} records. Proceeding with partial results for analysis.`,
        );
      }
      break;
    }
  }
  perfStats.fileProcessingTime = Date.now() - fileProcessStartTime;
  perfStats.recordsProcessed = counter.count;

  assert(
    dataSet.length === 0,
    "Data set should be empty after processing",
  );
  assert(
    selectedIndices.length === 0,
    "Indices should be empty after processing",
  );

  const scannedTime = Date.now() - startTime;
  if (shouldLogDiscovery(ctx.config)) {
    getLogger().info(
      `Discovery ${blue(ctx.ID)} scanning time ${
        yellow(format(scannedTime, { ignoreZero: true }))
      }`,
    );
  }

  // Wait for all pending writes to complete
  phaseDiagnostics.enterPhase("promise_wait");
  const WRITE_TIMEOUT_MS = 60000;
  const promiseWaitStartTime = Date.now();

  let timeoutId: number | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Discovery ${ctx.ID} file writes timed out after ${WRITE_TIMEOUT_MS}ms`,
          ),
        );
      }, WRITE_TIMEOUT_MS);
    });

    await Promise.race([
      Promise.all(neuronPromisesMap.values()),
      timeoutPromise,
    ]);
  } catch (error) {
    getLogger().error(
      `❌ DISCOVERY WRITE ERROR for ${blue(ctx.ID)}:`,
      error,
    );
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
  perfStats.promiseWaitTime = Date.now() - promiseWaitStartTime;
  neuronPromisesMap.clear();

  // Flush Rust recording
  const rustFlushSuccess = discoverStructure.flushRustRecording();
  if (!rustFlushSuccess) {
    if (shouldLogDiscovery(ctx.config)) {
      getLogger().warn(
        `⚠️  Discovery ${
          blue(ctx.ID)
        }: Rust recording failed, discovery skipped.`,
      );
    }
    return false;
  }

  const recordPhaseEndTime = Date.now();
  perfStats.recordPhaseTime = recordPhaseEndTime - startTime;

  if (shouldLogDiscovery(ctx.config)) {
    getLogger().info(
      `Discovery ${blue(ctx.ID)} recorded time ${
        yellow(format(perfStats.recordPhaseTime, { ignoreZero: true }))
      }`,
    );
  }

  return true;
}
