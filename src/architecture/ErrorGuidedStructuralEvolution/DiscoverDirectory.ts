import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { Creature } from "../../Creature.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import type { DiscoverResult } from "./DiscoverResult.ts";
import { DiscoverStructure } from "./DiscoverStructure.ts";

export async function recordDirectory(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
) {
  const recorder = new DataRecorder(creature, options);
  return await recorder.recordDirectory(dataDir);
}

class DataRecorder {
  private readonly BYTES_PER_RECORD: number;
  private readonly BATCH_SIZE: number;
  private readonly sampleRate: number;
  private readonly discoveryBatchSize: number;
  private readonly ID: string;
  private readonly timeoutTS: number;
  private readonly timeoutSeconds: number;
  private readonly discoveryMaxNeurons: number;

  constructor(
    private readonly creature: Creature,
    private readonly options: NeatOptions,
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

    this.discoveryMaxNeurons = Math.max(
      1,
      options.discoveryMaxNeurons || 6,
    );
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
    },
  ) {
    if (this.options.log) {
      console.log(`Discovery ${blue(this.ID)} processing ${filePath}`);
    }

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

    if (this.options.log) {
      console.log(
        `Discovery ${blue(this.ID)} read time ${
          yellow(format(readTime, { ignoreZero: true }))
        } for ${filePath} with ${params.counter.count} records`,
      );
    }
  }

  private async recordFiles(binaryFiles: string[]): Promise<DiscoverResult> {
    const { creature, options } = this;
    const startTime = Date.now();
    let currentPhase = "initialization"; // Track phase for timeout diagnostics

    if (options.log) {
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
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    const initializeStartTime = Date.now();
    discoverStructure.initialize(neuronPromisesMap);
    const initializeTime = Date.now() - initializeStartTime;

    // Declare timing variables outside try block for error diagnostics
    let fileProcessTime = 0;

    if (options.log) {
      console.log(
        `Discovery ${blue(this.ID)} initialize time ${
          yellow(format(initializeTime, { ignoreZero: true }))
        }`,
      );
    }
    try {
      const counter = { count: 0 };

      const dataSet: DataRecordInterface[] = [];
      const selectedIndices: number[] = [];

      currentPhase = "file_processing";
      const fileProcessStartTime = Date.now();
      for (const filePath of binaryFiles) {
        // deno-lint-ignore no-await-in-loop
        await this.processFile(filePath, discoverStructure, {
          counter,
          dataSet,
          neuronPromisesMap: neuronPromisesMap,
          selectedIndices,
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
        }

        if (this.timeoutTS && Date.now() > this.timeoutTS) {
          if (this.options.log) {
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

      // All data has been flushed per-file, so dataSet should be empty
      assert(dataSet.length === 0, "Data set should be empty after processing");
      assert(
        selectedIndices.length === 0,
        "Indices should be empty after processing",
      );

      const scannedTime = Date.now() - startTime;
      if (options.log) {
        console.log(
          `Discovery ${blue(this.ID)} scanning time ${
            yellow(format(scannedTime, { ignoreZero: true }))
          }`,
        );
      }

      // Incremental promise cleanup: remove promises as they complete to reduce memory
      // This allows GC to collect completed promises instead of accumulating them all
      const promiseCompletionTracker = new Map<
        string,
        { startTime: number }
      >();
      const totalPromises = neuronPromisesMap.size;

      // Wrap each promise to remove itself from the map on completion
      for (const [neuronUUID, promise] of neuronPromisesMap.entries()) {
        promiseCompletionTracker.set(neuronUUID, {
          startTime: Date.now(),
        });

        // Wrap promise to clean up on completion
        const cleanupPromise = promise.then(() => {
          neuronPromisesMap.delete(neuronUUID);
          promiseCompletionTracker.delete(neuronUUID);
        }).catch((_error) => {
          // Clean up even on error
          neuronPromisesMap.delete(neuronUUID);
          promiseCompletionTracker.delete(neuronUUID);
        });

        neuronPromisesMap.set(neuronUUID, cleanupPromise);
      }

      // Poll for completion instead of Promise.all() to allow incremental GC
      currentPhase = "promise_wait";
      const promiseWaitStartTime = Date.now();
      const WRITE_TIMEOUT_MS = 60000; // 60 seconds for all writes
      const POLL_INTERVAL_MS = 100; // Check every 100ms
      let completedCount = 0;

      while (neuronPromisesMap.size > 0) {
        const elapsed = Date.now() - promiseWaitStartTime;
        if (elapsed > WRITE_TIMEOUT_MS) {
          // Timeout - report diagnostics
          const pendingPromises: string[] = [];
          const now = Date.now();
          for (
            const [neuronUUID, tracker] of promiseCompletionTracker.entries()
          ) {
            const waitTime = now - tracker.startTime;
            pendingPromises.push(
              `${neuronUUID} (waiting ${(waitTime / 1000).toFixed(1)}s)`,
            );
          }

          console.error(
            `❌ DISCOVERY DEADLOCK DIAGNOSTIC for ${blue(this.ID)}:`,
          );
          console.error(
            `   Timeout: ${WRITE_TIMEOUT_MS}ms exceeded`,
          );
          console.error(
            `   Wait time: ${format(elapsed, { ignoreZero: true })}`,
          );
          console.error(
            `   Total promises: ${totalPromises}`,
          );
          console.error(
            `   Completed: ${completedCount}`,
          );
          console.error(
            `   Still pending: ${pendingPromises.length}`,
          );
          if (pendingPromises.length > 0 && pendingPromises.length <= 20) {
            console.error(`   Pending neuron UUIDs:`);
            pendingPromises.forEach((p) => console.error(`      - ${p}`));
          } else if (pendingPromises.length > 20) {
            console.error(`   Pending neuron UUIDs (first 20):`);
            pendingPromises.slice(0, 20).forEach((p) =>
              console.error(`      - ${p}`)
            );
          }

          console.warn(
            `Discovery ${blue(this.ID)} file writes timed out.`,
          );
          break; // Exit loop on timeout
        }

        // Yield to allow promises to complete and GC to run
        // deno-lint-ignore no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        // Track progress
        const newCompletedCount = totalPromises - neuronPromisesMap.size;
        if (newCompletedCount > completedCount) {
          completedCount = newCompletedCount;
          // Every 100 completions, give extra time for GC
          if (completedCount % 100 === 0) {
            // deno-lint-ignore no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }

      // Clear remaining entries to help GC
      neuronPromisesMap.clear();
      promiseCompletionTracker.clear();

      if (options.log) {
        const recordTime = Date.now() - startTime;
        console.log(
          `Discovery ${blue(this.ID)} recorded time ${
            yellow(format(recordTime, { ignoreZero: true }))
          }`,
        );
      }

      // Extend timeout for analysis phase - give it dedicated time regardless of recording duration
      // This ensures analysis isn't starved if recording takes a long time
      const analysisTimeoutMinutes = options.discoveryAnalysisTimeoutMinutes ??
        3; // Default 3 minutes for analysis
      const analysisTimeoutSeconds = analysisTimeoutMinutes * 60;
      discoverStructure.extendTimeoutForAnalysis(analysisTimeoutSeconds);

      if (options.log) {
        console.log(
          `Discovery ${blue(this.ID)} analysis timeout extended by ${
            yellow(analysisTimeoutMinutes.toString())
          }m`,
        );
      }

      const discoverResult: DiscoverResult = {
        ID: this.ID,
        addHelpfulSynapses: undefined,
        removeHarmfulSynapse: undefined,
        candidateSquashes: undefined,
      };

      currentPhase = "analyze_helpful";
      const analyzeStartTime = Date.now();

      const addHelpfulSynapse = await discoverStructure.analyze(
        this.discoveryMaxNeurons,
      );
      if (options.log) {
        const analyzeTime = Date.now() - analyzeStartTime;
        console.log(
          `Discovery ${blue(this.ID)} analyze time ${
            yellow(format(analyzeTime, { ignoreZero: true }))
          } found ${
            addHelpfulSynapse ? addHelpfulSynapse.length : 0
          } candidates`,
        );
      }

      if (addHelpfulSynapse) {
        discoverResult.addHelpfulSynapses = addHelpfulSynapse;
      }

      currentPhase = "analyze_harmful";
      const harmfulStartTime = Date.now();
      const removeHarmfulSynapse = await discoverStructure
        .analyzeSynapsesForRemoval(
          this.discoveryMaxNeurons,
        );
      if (options.log) {
        const harmfulTime = Date.now() - harmfulStartTime;
        console.log(
          `Discovery ${blue(this.ID)} analyze harmful time ${
            yellow(format(harmfulTime, { ignoreZero: true }))
          } found ${removeHarmfulSynapse ? 1 : 0} candidates`,
        );
      }
      if (removeHarmfulSynapse) {
        discoverResult.removeHarmfulSynapse = removeHarmfulSynapse;
      }

      currentPhase = "analyze_squash";
      const squashStartTime = Date.now();
      const candidateSquashes = await discoverStructure
        .analyzeNeuronsSquashes(
          this.discoveryMaxNeurons,
        );
      if (options.log) {
        const squashTime = Date.now() - squashStartTime;
        const squashCount = candidateSquashes ? candidateSquashes.length : 0;
        let squashSummaryText = "";
        if (squashCount > 0) {
          assert(candidateSquashes, "No candidate squashes");
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
      if (candidateSquashes) {
        discoverResult.candidateSquashes = candidateSquashes;
      }

      currentPhase = "complete";
      if (options.log) {
        const totalTime = Date.now() - startTime;
        console.log(
          `Discovery ${blue(this.ID)} analysis complete, total time ${
            yellow(format(totalTime, { ignoreZero: true }))
          }, starting cleanup...`,
        );
      }

      // Schedule cleanup to happen asynchronously without blocking the response
      // This prevents slow filesystem operations from delaying the discovery result
      const cleanupPromise = (async () => {
        if (options.log) {
          console.log(`Discovery ${blue(this.ID)} performing cleanup...`);
        }
        await discoverStructure.cleanUp();
        if (options.log) {
          console.log(`Discovery ${blue(this.ID)} cleanup complete.`);
        }
      })();

      // Don't await cleanup - let it happen in the background
      // Catch any errors to prevent unhandled rejections and resource leaks
      cleanupPromise.catch((error) => {
        console.error(
          `❌ CRITICAL: Discovery ${this.ID} cleanup failed - potential resource leak:`,
          error,
        );
      });

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
      console.error(`   Current phase: ${currentPhase}`);
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

      if (options.log) {
        console.log(
          `Discovery ${blue(this.ID)} error occurred, performing cleanup...`,
        );
      }
      try {
        await discoverStructure.cleanUp();
        if (options.log) {
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
}
