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
import { isRustDiscoveryEnabled } from "./RustDiscovery.ts";

const shouldLogDiscovery = (options: NeatOptions): boolean =>
  Boolean(options.verbose || (options.log && options.log > 0));

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
  private readonly timeoutTS: number;
  private readonly timeoutSeconds: number;
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
    // Check if Rust discovery module is available
    const rustEnabled = this.discoverDeps.isRustDiscoveryEnabled
      ? this.discoverDeps.isRustDiscoveryEnabled()
      : isRustDiscoveryEnabled();
    if (!rustEnabled) {
      if (shouldLogDiscovery(this.options)) {
        console.warn(
          `⚠️  Discovery skipped: Rust module not available. Discovery requires the NEAT-AI-Discovery Rust library to be built and available.`,
        );
      }
      // Return empty result - discovery is skipped
      return {
        ID: this.ID,
        addHelpfulSynapses: undefined,
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
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
    if (shouldLogDiscovery(this.options)) {
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

    if (shouldLogDiscovery(this.options)) {
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

      currentPhase = "file_processing";
      const fileProcessStartTime = Date.now();
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

        if (shouldLogDiscovery(this.options)) {
          console.log(
            `Discovery ${
              blue(this.ID)
            } drained promises after file ${filePath}`,
          );
        }

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
      currentPhase = "promise_wait";
      const WRITE_TIMEOUT_MS = 60000; // 60 seconds for all writes

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
          candidateSquashes: undefined,
        };
      }

      if (shouldLogDiscovery(options)) {
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
        candidateSquashes: undefined,
      };

      // Track attempted neurons to avoid re-analyzing the same ones
      const attemptedNeurons = new Set<string>();
      let retryAttempt = 0;
      const maxRetries = 10; // Reasonable limit to prevent infinite loops

      // Retry loop: try different neurons if no candidates found and time remains
      // Sequential execution is intentional - we check results after each attempt
      while (retryAttempt <= maxRetries) {
        const focusSelectStart = Date.now();
        // deno-lint-ignore no-await-in-loop
        const focusList = await discoverStructure.selectNeuronsWeightedByError(
          this.discoveryMaxNeurons,
        );

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

        currentPhase = "analyze_helpful";
        const analyzeStartTime = Date.now();

        // deno-lint-ignore no-await-in-loop
        const addHelpfulSynapse = await discoverStructure
          .analyzeSelectedNeurons(
            newFocusList,
          );
        if (shouldLogDiscovery(options)) {
          const analyzeTime = Date.now() - analyzeStartTime;
          console.log(
            `Discovery ${blue(this.ID)} analyze time ${
              yellow(format(analyzeTime, { ignoreZero: true }))
            } found ${
              addHelpfulSynapse ? addHelpfulSynapse.length : 0
            } synapse candidates`,
          );
        }

        if (addHelpfulSynapse) {
          discoverResult.addHelpfulSynapses = addHelpfulSynapse;
        }

        currentPhase = "analyze_neurons";
        const neuronAnalyzeStart = Date.now();
        // deno-lint-ignore no-await-in-loop
        const addHelpfulNeurons = await discoverStructure.analyzeMissingNeurons(
          newFocusList,
        );
        if (shouldLogDiscovery(options)) {
          const neuronAnalyzeTime = Date.now() - neuronAnalyzeStart;
          console.log(
            `Discovery ${blue(this.ID)} analyze neurons time ${
              yellow(format(neuronAnalyzeTime, { ignoreZero: true }))
            } found ${
              addHelpfulNeurons ? addHelpfulNeurons.length : 0
            } neuron candidates`,
          );
        }
        if (addHelpfulNeurons && addHelpfulNeurons.length > 0) {
          discoverResult.addHelpfulNeurons = addHelpfulNeurons;
        }

        currentPhase = "analyze_harmful";
        const harmfulStartTime = Date.now();
        // deno-lint-ignore no-await-in-loop
        const removeHarmfulSynapse = await discoverStructure
          .analyzeSelectedNeuronsForRemoval(newFocusList);
        if (shouldLogDiscovery(options)) {
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
        // deno-lint-ignore no-await-in-loop
        const candidateSquashes = await discoverStructure
          .analyzeSelectedNeuronsSquashes(newFocusList);
        if (shouldLogDiscovery(options)) {
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

        // Check if we found any candidates
        const foundCandidates = Boolean(
          discoverResult.addHelpfulSynapses ||
            discoverResult.addHelpfulNeurons ||
            discoverResult.removeHarmfulSynapse ||
            discoverResult.candidateSquashes,
        );

        // If we found candidates, we're done
        if (foundCandidates) {
          if (shouldLogDiscovery(options) && retryAttempt > 0) {
            console.log(
              `Discovery ${
                blue(this.ID)
              } found candidates after ${retryAttempt} retry attempt${
                retryAttempt === 1 ? "" : "s"
              }`,
            );
          }
          break;
        }

        // Check if we still have time for another retry
        const timeRemaining = this.timeoutTS - Date.now();
        if (timeRemaining <= 0) {
          if (shouldLogDiscovery(options)) {
            console.log(
              `Discovery ${
                blue(this.ID)
              } no candidates found and analysis timeout reached`,
            );
          }
          break;
        }

        // Log retry decision
        retryAttempt++;
        if (shouldLogDiscovery(options)) {
          console.log(
            `Discovery ${
              blue(this.ID)
            } no candidates found, retrying with different neurons (${
              yellow(format(timeRemaining, { ignoreZero: true }))
            } remaining)`,
          );
        }
      }

      currentPhase = "complete";
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
      const cleanupPromise = (async () => {
        if (shouldLogDiscovery(options)) {
          console.log(`Discovery ${blue(this.ID)} performing cleanup...`);
        }
        await discoverStructure.cleanUp();
        if (shouldLogDiscovery(options)) {
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
}
