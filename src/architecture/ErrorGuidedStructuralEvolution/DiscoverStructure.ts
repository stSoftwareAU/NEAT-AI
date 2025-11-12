import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { addTag, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil } from "../../../mod.ts";
import { Creature } from "../../Creature.ts";
import type { Approach } from "../../NEAT/LogApproach.ts";
import { memeticUpdate } from "../../blackbox/MemeticUpdate.ts";
import { MSE } from "../../costs/MSE.ts";
import type { ActivationInterface } from "../../methods/activations/ActivationInterface.ts";
import { Activations } from "../../methods/activations/Activations.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import {
  analyzeNeurons,
  analyzeSynapses,
  creatureToRustFormat,
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  readDiscoveryRecords,
  recordDiscovery,
  type RustAnalyzeNeuronsInput,
  type RustAnalyzeNeuronsResult,
  type RustAnalyzeSynapsesInput,
  type RustAnalyzeSynapsesResult,
  type RustCandidateNeuron,
  type RustCandidateSynapse,
  type RustRecordInput,
} from "./RustDiscovery.ts";

/**
 * Implements Error-Driven Synapse Discovery, a neuroevolution technique for optimizing neural network structures.
 * This class analyzes neuron activations and back-propagation errors to discover beneficial new synapses
 * that explicitly reduce neuron-level errors.
 *
 * References:
 * - Stanley, K. O., & Miikkulainen, R. (2002). Evolving Neural Networks through Augmenting Topologies (NEAT).
 *   Evolutionary Computation, 10(2), 99–127.
 * - Floreano, D., Dürr, P., & Mattiussi, C. (2008). Neuroevolution: from architectures to learning. Evolutionary Intelligence, 1(1), 47-62.
 */

export interface DiscoverRecord {
  activation: number;
  errors: number[];
  value?: number;
}

/**
 * Tracks which binary file records were selected during discovery.
 * Maps binary file paths to arrays of record indices.
 */
export interface BinaryRecordIndices {
  [binaryFile: string]: number[];
}

/**
 * Represents a potential new synapse and the associated metrics calculated during discovery.
 */
export interface CandidateSynapse {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  weight: number;
  expectedImprovementPercentage: number;
  improvedCount: number;
  totalCount: number;
}

export interface CandidateSquash {
  neuronUUID: string;
  previousSquash: string;
  squash: string;
  expectedImprovementPercentage: number;
  improvedError: number;
  currentError: number;
}

export interface CandidateNeuron {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  incomingWeight: number;
  outgoingWeight: number;
  squash: string;
  bias: number;
  expectedImprovementPercentage: number;
  improvedCount: number;
  totalCount: number;
}

/**
 * Represents a neuron and its total accumulated error for ranking neurons during discovery.
 */
interface NeuronErrorInfo {
  uuid: string;
  totalError: number;
}

const RUST_HELPFUL_THRESHOLD = 0.1;
const RUST_HARMFUL_THRESHOLD = -0.1;

/**
 * Implements Error-Driven Synapse Discovery, analyzing neuron activations
 * and errors to identify beneficial new synapses that explicitly reduce neuron-level errors.
 */
export class DiscoverStructure {
  private creature: Creature;
  private tempDir: string;
  private textDecoder: TextDecoder;
  private timeoutTS: number;
  private loggingEnabled = false;
  private discoveryID: string;

  private initialized = false;
  private recorded = false;

  private selectedIndices: BinaryRecordIndices = {};
  private indicesFilePath: string;

  // Rust recording: accumulate data for Rust Parquet writing (Rust is required)
  private rustAccumulatedData: DataRecordInterface[] = [];
  private rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>> = [];
  private rustBinaryFilePath: string | null = null;
  private rustBinaryFilePaths: Set<string> = new Set(); // Track all binary file paths
  private usingRustDualWrite = false;
  private parquetFilePath: string | null = null;
  constructor(creature: Creature, timeoutSeconds: number) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    this.tempDir = `.discovery/${creature.uuid}_${
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    }`;
    this.indicesFilePath = `${this.tempDir}/selected_indices.json`;
    this.textDecoder = new TextDecoder();
    this.discoveryID = creature.uuid;
    assert(
      timeoutSeconds > 0,
      `Timeout seconds must be greater than 0, was: ${timeoutSeconds}`,
    );
    assert(
      timeoutSeconds <= 60 * 60,
      `Timeout seconds must be less than 1 hour: was ${timeoutSeconds}`,
    );
    this.timeoutTS = Date.now() + timeoutSeconds * 1000;

    Deno.mkdirSync(this.tempDir, { recursive: true });
  }

  public configureLogging(options: {
    verbose?: boolean;
    discoveryID?: string;
  }): void {
    this.loggingEnabled = Boolean(options?.verbose);
    if (options?.discoveryID) {
      this.discoveryID = options.discoveryID;
    }
  }

  /**
   * Extends the timeout to allow analysis phase to complete.
   * Call this after recording phase completes to ensure analysis gets adequate time.
   * @param analysisTimeSeconds - Number of seconds to allocate for analysis phase
   */
  public extendTimeoutForAnalysis(analysisTimeSeconds: number): void {
    assert(
      analysisTimeSeconds > 0,
      `Analysis time must be greater than 0, was: ${analysisTimeSeconds}`,
    );
    this.timeoutTS = Date.now() + analysisTimeSeconds * 1000;
  }

  /**
   * Initializes the discovery process.
   * Requires the NEAT-AI-Discovery Rust library to be available.
   * Discovery will fail gracefully if Rust module is not available.
   */
  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    // Check if Rust discovery is enabled (requires both library file AND FFI permissions)
    if (!isRustDiscoveryEnabled()) {
      console.warn(
        `⚠️  Discovery requires the NEAT-AI-Discovery Rust library and FFI permissions. Discovery will be skipped.`,
      );
      // Set up empty promises - discovery will fail gracefully
      this.creature.neurons.forEach((neuron) => {
        neuronPromisesMap.set(neuron.uuid, Promise.resolve());
      });
      return;
    }

    // Rust discovery is enabled - set up for Rust recording
    this.usingRustDualWrite = true;

    // Set up promise placeholders for all neurons (Rust handles file creation)
    this.creature.neurons.forEach((neuron) => {
      neuronPromisesMap.set(neuron.uuid, Promise.resolve());
    });

    // Initialize the indices file as an empty JSON object
    Deno.writeTextFileSync(this.indicesFilePath, "{}", { createNew: true });
  }

  /**
   * Cleans up temporary resources and resets the internal state after discovery.
   * Also closes the Rust library to avoid leak detection warnings in tests.
   */
  public async cleanUp() {
    assert(this.initialized, "Not initialized");
    this.initialized = false;
    this.recorded = false;
    this.creature.dispose();
    this.discoveries = [];
    this.neuronDiscoveries = [];

    // Clear selectedIndices to help GC
    this.selectedIndices = {};

    // Clear references to help GC
    // @ts-ignore - clearing to help GC
    this.creature = null;
    // @ts-ignore - clearing to help GC
    this.discoveries = null;
    // @ts-ignore - clearing to help GC
    this.neuronDiscoveries = null;

    // Close Rust library if it was loaded (for test cleanup)
    try {
      const { closeRustLibrary } = await import("./RustDiscovery.ts");
      closeRustLibrary();
    } catch {
      // Ignore errors during cleanup
    }

    try {
      await Deno.remove(this.tempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors to prevent crashes
      console.warn(`Failed to cleanup discovery temp dir: ${error}`);
    }
  }

  /**
   * Records neuron activations and errors across the provided training data.
   * Requires the NEAT-AI-Discovery Rust library - discovery fails gracefully if not available.
   * Accumulates data for batch processing via Rust module (Parquet format).
   */
  public record(
    trainingData: DataRecordInterface[],
    _neuronPromisesMap: Map<string, Promise<void>>,
    binaryFilePath?: string,
    recordIndices?: number[],
  ): boolean {
    assert(this.initialized, "Not initialized");
    if (Date.now() > this.timeoutTS) {
      return false;
    }
    this.recorded = true;

    // Rust module is required - if not available, discovery was already skipped in initialize()
    if (!this.usingRustDualWrite) {
      return false; // Discovery skipped - Rust not available
    }

    // Track selected indices if provided (from binary file processing)
    if (binaryFilePath && recordIndices && recordIndices.length > 0) {
      if (!this.selectedIndices[binaryFilePath]) {
        this.selectedIndices[binaryFilePath] = [];
      }
      this.selectedIndices[binaryFilePath].push(...recordIndices);

      // Write indices to JSON file after accumulating them
      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      // Store binary file path for Rust (keep first for backward compatibility)
      if (!this.rustBinaryFilePath) {
        this.rustBinaryFilePath = binaryFilePath;
      }
      // Track all binary file paths
      this.rustBinaryFilePaths.add(binaryFilePath);
    }

    // Process each record and accumulate data for Rust batch processing
    for (let i = 0; i < trainingData.length; i++) {
      const record = trainingData[i];

      // Activate creature with existing input
      this.creature.activate(record.input);
      const discoverMap = this.creature.record(record.output);

      // Accumulate data for Rust (Parquet format)
      this.rustAccumulatedData.push(record);
      this.rustAccumulatedNeuronData.push(discoverMap);
    }

    return true;
  }

  /**
   * Flushes accumulated Rust recording data and writes to Parquet via Rust module.
   * This is called after all record() batches complete.
   * Returns true if Rust write succeeded or if there's no data to flush (valid no-op),
   * false if Rust not available or failed.
   *
   * NOTE: This is where we actually LOAD the Rust library (lazy loading).
   * We check file existence earlier (rustLibraryExists) to avoid loading unnecessarily.
   * If Rust module is not available, this returns false and discovery is skipped.
   * If there's no accumulated data (empty training data), this returns true (valid no-op).
   */
  public flushRustRecording(): boolean {
    // If Rust is not being used, return false (discovery skipped)
    if (!this.usingRustDualWrite) {
      return false;
    }

    // If there's no data to flush, return true (valid no-op, not an error)
    if (this.rustAccumulatedData.length === 0) {
      return true;
    }

    // Check if creature has been cleaned up (race condition protection)
    // @ts-ignore - creature can be null after cleanUp()
    if (!this.creature) {
      console.warn(
        `⚠️  Discovery recording skipped: creature has been cleaned up.`,
      );
      return false;
    }

    // Now actually load the library (lazy loading - only when we need to write)
    if (!isRustLibraryAvailable()) {
      console.warn(
        `⚠️  Rust library not available when flushing. Discovery recording failed.`,
      );
      return false;
    }

    try {
      const creatureExport = this.creature.exportJSON();
      const rustCreature = creatureToRustFormat(creatureExport);
      const pendingSamples = this.rustAccumulatedData.length;

      const nonInputNeurons = this.creature.neurons.filter((neuron) =>
        neuron.type !== "input"
      );

      const rustTrainingData = this.rustAccumulatedData.map((record, index) => {
        const discoverMap = this.rustAccumulatedNeuronData[index];

        const neuronData = nonInputNeurons.map((neuron) => {
          const discoverRecord = discoverMap.get(neuron.uuid) || {
            activation: this.creature.state.activations[neuron.index],
            errors: [] as number[],
          };

          const errors = discoverRecord.errors.filter(Number.isFinite);

          return {
            neuron_uuid: neuron.uuid,
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

      // Prepare record indices if we have binary files with specific indices
      // NOTE: Indices stored in selectedIndices are file-specific (indices within each binary file),
      // not training-data indices. When multiple files are processed, we can't reliably map
      // file-specific indices to training-data indices without tracking offsets.
      // For single file: use file-specific indices (they should map 1:1 to training data)
      // For multiple files: use sequential indices (0, 1, 2, ...) to match training data order
      let recordIndices: number[] | undefined = undefined;
      if (this.rustBinaryFilePaths.size === 1 && this.rustBinaryFilePath) {
        // Single binary file: use its file-specific indices
        // These should map 1:1 to training data since only one file was processed
        const fileIndices = this.selectedIndices[this.rustBinaryFilePath];
        if (fileIndices && fileIndices.length > 0) {
          // Verify indices match training data length (should be 1:1 for single file)
          if (fileIndices.length === this.rustAccumulatedData.length) {
            recordIndices = fileIndices;
          } else {
            // Mismatch - use sequential indices for safety
            recordIndices = undefined;
          }
        } else {
          // No indices found - use sequential indices
          recordIndices = undefined;
        }
      } else if (this.rustBinaryFilePaths.size > 1) {
        // Multiple binary files: can't map file-specific indices to training-data indices
        // Use sequential indices (0, 1, 2, ...) to match training data order
        recordIndices = undefined;
      } else {
        // No binary file - don't provide record_indices (let Rust process all records sequentially)
        // This ensures obs_index in Parquet matches the training data index (0, 1, 2, ...)
        recordIndices = undefined;
      }

      const now = Date.now();
      const timedOut = now > this.timeoutTS;
      if (timedOut) {
        this.log(
          "warn",
          "Submitting flush request to Rust after recording timeout expired. Continuing with captured data.",
        );
      }

      // Calculate timeout_seconds, ensuring it's non-negative. If we've already
      // exceeded the timeout window we pass zero so Rust can decide whether to proceed.
      const timeoutSeconds = timedOut
        ? 0
        : Math.max(0, Math.floor((this.timeoutTS - now) / 1000));

      const rustInput: RustRecordInput = {
        creature: rustCreature,
        "training_data": rustTrainingData,
        "temp_dir": this.tempDir,
        "binary_file_path": this.rustBinaryFilePath || undefined,
        "record_indices": recordIndices,
        "timeout_seconds": timeoutSeconds,
      };

      const result = recordDiscovery(rustInput);

      if (result && result.success && result.file) {
        this.parquetFilePath = `${this.tempDir}/${result.file}`;

        // Write indices file for input neuron binary reading
        // For single file: use the calculated recordIndices or sequential indices
        // For multiple files: write all file-specific indices (even though we use sequential for Rust)
        if (this.rustBinaryFilePaths.size > 0) {
          let indicesToWrite: BinaryRecordIndices;
          if (this.rustBinaryFilePaths.size === 1 && recordIndices) {
            // Single file with valid indices: use the calculated indices
            indicesToWrite = {
              [this.rustBinaryFilePath!]: recordIndices,
            };
          } else {
            // Multiple files or no valid indices: write all file-specific indices
            // (Note: Rust will use sequential indices, but we preserve file-specific indices for reference)
            indicesToWrite = { ...this.selectedIndices };
          }
          Deno.writeTextFileSync(
            this.indicesFilePath,
            JSON.stringify(indicesToWrite),
          );
        } else if (this.rustAccumulatedData.length > 0) {
          // No binary file path - create a temporary binary file from training data
          // This allows input neurons to be read (they're always read from binary files)
          const tempBinaryFile = `${this.tempDir}/training_data.bin`;
          const BYTES_PER_RECORD =
            (this.creature.input + this.creature.output) * 4;
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
              const record = this.rustAccumulatedData[i];
              // Write input values
              for (let j = 0; j < this.creature.input; j++) {
                recordArray[j] = record.input[j];
              }
              // Write output values
              for (let j = 0; j < this.creature.output; j++) {
                recordArray[this.creature.input + j] = record.output[j];
              }

              file.writeSync(buffer);
              sequentialIndices.push(i);
            }

            // Write indices file pointing to the temporary binary file
            const indices: BinaryRecordIndices = {
              [tempBinaryFile]: sequentialIndices,
            };
            Deno.writeTextFileSync(
              this.indicesFilePath,
              JSON.stringify(indices),
            );

            // Store the temporary binary file path
            this.rustBinaryFilePath = tempBinaryFile;
          } finally {
            file.close();
          }
        }

        // Clear accumulated data after successful write
        this.rustAccumulatedData = [];
        this.rustAccumulatedNeuronData = [];
        const flushDuration = Date.now() - now;
        const remainingSeconds = Math.max(
          0,
          Math.floor((this.timeoutTS - Date.now()) / 1000),
        );
        this.log(
          "info",
          `Flushed ${pendingSamples} samples to ${this.parquetFilePath} in ${
            this.formatMillis(flushDuration)
          } (timeout remaining: ${remainingSeconds}s).`,
        );

        return true;
      }
      console.error(
        `❌ Rust discovery recording failed: ${
          result?.error || "Unknown error"
        }`,
      );
      return false;
    } catch {
      return false;
    }
  }

  private discoveries: CandidateSynapse[] = [];
  private neuronDiscoveries: CandidateNeuron[] = [];

  public analyzeSelectedNeurons(
    focusList: string[],
  ): Promise<CandidateSynapse[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeSelectedNeurons");
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !isRustDiscoveryEnabled()) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          "Rust discovery unavailable; skipping analyzeSelectedNeurons",
        );
      }
      return Promise.resolve(undefined);
    }

    const rustCandidates = this.tryRustHelpfulSynapses(focusList);
    if (!rustCandidates || rustCandidates.length === 0) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          `Rust helpful synapse analysis returned no candidates for ${
            focusList.join(", ")
          }.`,
        );
      }
      return Promise.resolve(undefined);
    }

    rustCandidates.forEach((candidate) => this.upsertDiscovery(candidate));
    const topCandidate = rustCandidates[0];
    this.logHelpfulSynapse(topCandidate);
    return Promise.resolve(this.discoveries);
  }

  public analyzeMissingNeurons(
    focusList: string[],
  ): Promise<CandidateNeuron[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeMissingNeurons");
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !isRustDiscoveryEnabled()) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          "Rust discovery unavailable; skipping analyzeMissingNeurons",
        );
      }
      return Promise.resolve(undefined);
    }

    const rustCandidates = this.tryRustHelpfulNeurons(focusList);
    if (!rustCandidates || rustCandidates.length === 0) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          `Rust neuron analysis returned no candidates for ${
            focusList.join(", ")
          }.`,
        );
      }
      return Promise.resolve(undefined);
    }

    const bestCandidates = this.filterTopNeuronCandidates(rustCandidates);
    bestCandidates.forEach((candidate) => {
      this.upsertNeuronDiscovery(candidate);
      this.logHelpfulNeuron(candidate);
    });
    return Promise.resolve(bestCandidates);
  }

  private logHelpfulSynapse(
    candidate: CandidateSynapse,
  ): void {
    this.log(
      "info",
      `Rust discovered beneficial synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID} with weight ${
        candidate.weight.toFixed(4)
      }, helping ${
        (candidate.expectedImprovementPercentage * 100).toFixed(1)
      }% more records than it harms (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private logHelpfulNeuron(
    candidate: CandidateNeuron,
  ): void {
    this.log(
      "info",
      `Rust discovered beneficial ${candidate.squash} neuron linking ${candidate.fromNeuronUUID} -> ${candidate.toNeuronUUID} with incoming ${
        candidate.incomingWeight.toFixed(4)
      } and outgoing ${candidate.outgoingWeight.toFixed(4)}, improving ${
        (candidate.expectedImprovementPercentage * 100).toFixed(1)
      }% of records (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private tryRustHelpfulNeurons(
    focusList: string[],
  ): CandidateNeuron[] | undefined {
    const rustResult = this.runRustNeuronAnalysis(focusList);
    if (!rustResult || !rustResult.helpfulNeurons) {
      return undefined;
    }

    const candidates = rustResult.helpfulNeurons
      .map((candidate) => this.mapRustNeuronCandidate(candidate))
      .filter((candidate) =>
        candidate.expectedImprovementPercentage > RUST_HELPFUL_THRESHOLD
      );

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
    return candidates;
  }

  private tryRustHelpfulSynapses(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const rustResult = this.runRustSynapseAnalysis(focusList);
    if (!rustResult || !rustResult.helpfulSynapses) {
      return undefined;
    }

    const candidates = rustResult.helpfulSynapses
      .map((candidate) => this.mapRustCandidate(candidate))
      .filter((candidate) =>
        candidate.expectedImprovementPercentage > RUST_HELPFUL_THRESHOLD
      );

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
    return candidates;
  }

  private tryRustHarmfulCandidates(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const rustResult = this.runRustSynapseAnalysis(focusList);
    if (!rustResult || !rustResult.harmfulSynapses) {
      return undefined;
    }

    const candidates = rustResult.harmfulSynapses
      .map((candidate) => this.mapRustCandidate(candidate))
      .filter((candidate) =>
        candidate.expectedImprovementPercentage < RUST_HARMFUL_THRESHOLD
      );

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) =>
      a.expectedImprovementPercentage - b.expectedImprovementPercentage
    );
    return candidates;
  }

  private candidateKey(candidate: CandidateSynapse): string {
    return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
  }

  private neuronCandidateKey(candidate: CandidateNeuron): string {
    return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
  }

  private upsertDiscovery(candidate: CandidateSynapse): void {
    const key = this.candidateKey(candidate);
    const existingIndex = this.discoveries.findIndex((existing) =>
      this.candidateKey(existing) === key
    );
    if (existingIndex >= 0) {
      this.discoveries[existingIndex] = candidate;
    } else {
      this.discoveries.push(candidate);
    }
    this.discoveries.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
  }

  private upsertNeuronDiscovery(candidate: CandidateNeuron): void {
    const key = this.neuronCandidateKey(candidate);
    const existingIndex = this.neuronDiscoveries.findIndex((existing) =>
      this.neuronCandidateKey(existing) === key
    );
    if (existingIndex >= 0) {
      this.neuronDiscoveries[existingIndex] = candidate;
    } else {
      this.neuronDiscoveries.push(candidate);
    }
    this.neuronDiscoveries.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
  }

  private filterTopNeuronCandidates(
    candidates: CandidateNeuron[],
  ): CandidateNeuron[] {
    const grouped = new Map<string, CandidateNeuron>();
    candidates.forEach((candidate) => {
      const existing = grouped.get(candidate.toNeuronUUID);
      if (
        !existing ||
        candidate.expectedImprovementPercentage >
          existing.expectedImprovementPercentage
      ) {
        grouped.set(candidate.toNeuronUUID, candidate);
      }
    });
    return Array.from(grouped.values()).sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
  }

  private logHarmfulSynapse(candidate: CandidateSynapse): void {
    const harmPercent = Math.abs(candidate.expectedImprovementPercentage * 100);
    this.log(
      "info",
      `Rust discovered harmful synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID}, harming ${
        harmPercent.toFixed(1)
      }% more records than it helps (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private mapRustCandidate(
    candidate: RustCandidateSynapse,
  ): CandidateSynapse {
    return {
      fromNeuronUUID: candidate.fromNeuronUuid,
      toNeuronUUID: candidate.toNeuronUuid,
      weight: candidate.weight,
      expectedImprovementPercentage: candidate.expectedImprovementPercentage,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
    };
  }

  private mapRustNeuronCandidate(
    candidate: RustCandidateNeuron,
  ): CandidateNeuron {
    return {
      fromNeuronUUID: candidate.sourceNeuronUuid,
      toNeuronUUID: candidate.targetNeuronUuid,
      incomingWeight: candidate.incomingWeight,
      outgoingWeight: candidate.outgoingWeight,
      squash: candidate.squash,
      bias: candidate.bias,
      expectedImprovementPercentage: candidate.expectedImprovementPercentage,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
    };
  }

  private runRustNeuronAnalysis(
    focusList: string[],
  ): RustAnalyzeNeuronsResult | undefined {
    if (!this.parquetFilePath) {
      return undefined;
    }

    if (!isRustDiscoveryEnabled() || !isRustLibraryAvailable()) {
      return undefined;
    }

    const rustInput: RustAnalyzeNeuronsInput = {
      parquetFile: this.parquetFilePath,
      creature: creatureToRustFormat(this.creature.exportJSON()),
      focusNeurons: focusList,
      improvementThreshold: RUST_HELPFUL_THRESHOLD,
      maxCandidates: Math.max(25, focusList.length * 5),
      requireGpu: Deno.build.os === "darwin",
    };

    try {
      const result = analyzeNeurons(rustInput);
      if (!result || !result.success) {
        if (this.loggingEnabled) {
          this.log(
            "debug",
            `Rust neuron analysis failed: ${result?.error ?? "Unknown error"}`,
          );
        }
        return undefined;
      }
      if (Deno.env.get("DEBUG_RUST_ANALYSIS") === "1") {
        console.log(
          "rust-neuron-analysis",
          JSON.stringify({ focusList, result }, (_key, value) => value, 2),
        );
      }
      return result;
    } catch (error) {
      this.log(
        "warn",
        `Rust neuron analysis threw error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
      return undefined;
    }
  }

  private runRustSynapseAnalysis(
    focusList: string[],
  ): RustAnalyzeSynapsesResult | undefined {
    if (!this.parquetFilePath) {
      return undefined;
    }

    if (!isRustDiscoveryEnabled() || !isRustLibraryAvailable()) {
      return undefined;
    }

    const rustInput: RustAnalyzeSynapsesInput = {
      parquetFile: this.parquetFilePath,
      creature: creatureToRustFormat(this.creature.exportJSON()),
      focusNeurons: focusList,
      improvementThreshold: RUST_HELPFUL_THRESHOLD,
      maxCandidates: Math.max(50, focusList.length * 10),
      requireGpu: Deno.build.os === "darwin",
    };

    try {
      const result = analyzeSynapses(rustInput);
      if (!result || !result.success) {
        if (this.loggingEnabled) {
          this.log(
            "debug",
            `Rust synapse analysis failed: ${result?.error ?? "Unknown error"}`,
          );
        }
        return undefined;
      }
      if (Deno.env.get("DEBUG_RUST_ANALYSIS") === "1") {
        console.log(
          "rust-analysis",
          JSON.stringify({ focusList, result }, (_key, value) => value, 2),
        );
      }
      return result;
    } catch (error) {
      this.log(
        "warn",
        `Rust synapse analysis threw error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Analyzes recorded neuron data to identify and evaluate potential synapse additions.
   */
  public async analyze(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSynapse[] | undefined> {
    if (this.recorded === false) {
      this.log("warn", "No recorded data to analyze.");
      return undefined;
    }
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
    return this.analyzeSelectedNeurons(focusList);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ): void {
    const prefix = `[Discovery ${this.discoveryID}] ${message}`;
    const args = details === undefined ? [prefix] : [prefix, details];

    switch (level) {
      case "debug":
        if (this.loggingEnabled) console.debug(...args);
        break;
      case "info":
        if (this.loggingEnabled) console.info(...args);
        break;
      case "warn":
        console.warn(...args);
        break;
      case "error":
        console.error(...args);
        break;
      default:
        console.log(...args);
        break;
    }
  }

  private formatMillis(duration: number): string {
    const seconds = Math.floor(duration / 1000);
    const milliseconds = duration % 1000;
    if (seconds <= 0) {
      return `${milliseconds}ms`;
    }
    return `${seconds}s ${milliseconds.toString().padStart(3, "0")}ms`;
  }

  private processCSVRecord(
    headers: string[],
    values: string[],
  ): DiscoverRecord | null {
    // Handle case where we have more values than headers
    if (values.length > headers.length) {
      // Truncate values to match headers length without warning for performance
      values = values.slice(0, headers.length);
    }

    // Handle case where we have fewer values than headers
    if (values.length < headers.length) {
      // Pad values with empty strings to match headers length without warning for performance
      while (values.length < headers.length) {
        values.push("");
      }
    }

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index];
    });

    const activation = Number.parseFloat(record.activation);
    if (!Number.isFinite(activation)) {
      return null;
    }

    let value = Number.parseFloat(record.value);
    if (!Number.isFinite(value)) {
      value = activation;
    }

    const rawErrors = record.errors ?? "";
    const errors = rawErrors.length === 0
      ? []
      : rawErrors.split("|").map(Number).filter(Number.isFinite);

    return { value, activation, errors };
  }

  private processCSVChunk(
    chunk: string,
    partialLine: string,
    headers: string[],
    isFirstLine: boolean,
    records: DiscoverRecord[],
  ): string {
    const lines = (partialLine + chunk).split("\n");
    const newPartialLine = lines.pop() || ""; // Keep the last partial line for next iteration

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) continue;

      if (isFirstLine) {
        const headerValues = parseCsv(trimmedLine, { skipFirstRow: false })[0];
        headers.push(...headerValues);
        isFirstLine = false;
        continue;
      }

      const values = parseCsv(trimmedLine, { skipFirstRow: false })[0];
      const record = this.processCSVRecord(headers, values);
      if (record) {
        records.push(record);
      }
    }

    // Clear lines array to help GC
    lines.length = 0;

    return newPartialLine;
  }

  private async openFileWithRetry(
    file: string,
    maxRetries = 5,
    initialDelay = 200,
  ): Promise<Deno.FsFile> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        // deno-lint-ignore no-await-in-loop
        return await Deno.open(file);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Too many open files") && retries < maxRetries
        ) {
          console.warn(
            `Too many open files, retrying in ${delay}ms (attempt ${
              retries + 1
            }/${maxRetries})`,
          );
          // deno-lint-ignore no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          retries++;
          continue;
        }
        throw error; // Re-throw if it's not a "Too many open files" error or we've exhausted retries
      }
    }
  }

  /**
   * Loads input neuron activation data directly from binary files using stored indices.
   * This avoids writing and reading CSV files for input neurons.
   */
  private async loadInputNeuronFromBinary(
    neuronIndex: number,
  ): Promise<DiscoverRecord[]> {
    // Read the selected indices from JSON file
    const indicesContent = await Deno.readTextFile(this.indicesFilePath);
    const indices: BinaryRecordIndices = JSON.parse(indicesContent);

    const records: DiscoverRecord[] = [];
    const BYTES_PER_RECORD = (this.creature.input + this.creature.output) * 4;

    // Process each binary file that has selected indices
    // Collect file reading promises to avoid await in loop
    const fileReadPromises = Object.entries(indices).map(
      async ([binaryFile, recordIndices]) => {
        const file = await this.openFileWithRetry(binaryFile);
        const fileRecords: DiscoverRecord[] = [];

        try {
          const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
          const recordArray = new Float32Array(recordBuffer.buffer);

          for (const recordIndex of recordIndices) {
            // Seek to the record position
            const targetPosition = recordIndex * BYTES_PER_RECORD;
            file.seekSync(targetPosition, Deno.SeekMode.Start);

            // Read the record
            const bytesRead = file.readSync(recordBuffer);
            if (bytesRead === null || bytesRead !== BYTES_PER_RECORD) {
              console.warn(
                `Failed to read record ${recordIndex} from ${binaryFile}`,
              );
              continue;
            }

            // Extract the input value at the specified index
            // Binary format: [input0, input1, ..., inputN, output0, ..., outputM]
            const activation = recordArray[neuronIndex];

            fileRecords.push({
              activation,
              errors: [], // Input neurons don't have errors
            });
          }
        } finally {
          file.close();
        }

        return fileRecords;
      },
    );

    // Wait for all file reads to complete
    const allFileRecords = await Promise.all(fileReadPromises);

    // Flatten the results into a single array
    for (const fileRecords of allFileRecords) {
      records.push(...fileRecords);
    }

    return records;
  }

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    // Check if this is an input neuron - always read from binary files
    const fileName = file.split("/").pop();
    if (fileName && fileName.startsWith("input-")) {
      // Extract neuron index from filename like "input-5.csv"
      const match = fileName.match(/^input-(\d+)\.csv$/);
      if (match) {
        const neuronIndex = parseInt(match[1], 10);

        // Always read from binary files (input neurons are never in Parquet)
        try {
          const indicesContent = await Deno.readTextFile(this.indicesFilePath);
          const indices: BinaryRecordIndices = JSON.parse(indicesContent);

          // If we have binary indices, use them
          if (Object.keys(indices).length > 0) {
            return await this.loadInputNeuronFromBinary(neuronIndex);
          }
        } catch {
          // No indices file or empty - return empty
          return [];
        }
      }
    }

    // For non-input neurons, read from Parquet (Rust is required)
    if (!this.parquetFilePath) {
      throw new Error(
        "Parquet file path not set. Discovery requires the NEAT-AI-Discovery Rust library.",
      );
    }

    // Extract neuron UUID from filename like "hidden-3.csv"
    const match = fileName?.match(/^(.+)\.csv$/);
    if (!match) {
      throw new Error(`Invalid neuron file name: ${fileName}`);
    }
    const neuronUUID = match[1];

    // Verify Parquet file exists before reading
    try {
      Deno.statSync(this.parquetFilePath);
    } catch {
      throw new Error(
        `Parquet file does not exist: ${this.parquetFilePath}`,
      );
    }

    // Read from Parquet via Rust FFI (simple approach - optimize later)
    const readResult = readDiscoveryRecords({
      parquet_file: this.parquetFilePath,
      neuron_uuid: neuronUUID,
    });

    if (readResult && readResult.success && readResult.records) {
      // Convert Rust records to TypeScript format
      // Sort by obs_index to ensure records are in the same order as they were written
      const sortedRecords = [...readResult.records].sort(
        (a, b) => a.obs_index - b.obs_index,
      );
      const converted = sortedRecords.map((r) => ({
        activation: r.activation,
        value: r.value ?? r.activation, // Use activation as fallback for value
        errors: [...r.errors],
      }));

      return converted;
    } else {
      // Rust reading failed
      throw new Error(
        `Failed to read discovery records from Parquet: ${
          readResult?.error || "Unknown error"
        }`,
      );
    }
  }

  /**
   * Lists neurons sorted by their total error, useful for error-driven selection processes.
   */
  public async listViableNeurons(): Promise<NeuronErrorInfo[]> {
    if (!this.recorded) {
      console.warn("No recorded data to list neurons.");
      return [];
    }

    const neurons = this.creature.neurons.filter((neuron) =>
      neuron.type !== "input"
    );

    // Process neurons in batches to avoid overwhelming the file system
    // with too many concurrent file operations (prevents "too many open files" errors)
    const BATCH_SIZE = 50;
    const results: NeuronErrorInfo[] = [];
    let totalInvalidErrorCount = 0;
    let neuronsWithInvalidErrors = 0;

    for (let i = 0; i < neurons.length; i += BATCH_SIZE) {
      const batch = neurons.slice(i, i + BATCH_SIZE);

      // Check timeout before each batch
      if (Date.now() > this.timeoutTS) {
        console.warn(
          `Discovery timeout reached while listing neurons (${i}/${neurons.length} processed)`,
        );
        break;
      }

      const batchPromises = batch.map(async (neuron) => {
        try {
          const records = await this.loadCSV(
            `${this.tempDir}/${neuron.uuid}.csv`,
          );

          let invalidErrorCount = 0;
          const totalError = records.reduce((sum, record) => {
            const errors = record.errors;
            const recordError = errors.reduce((eSum, e) => {
              if (!Number.isFinite(e)) {
                invalidErrorCount++;
                return eSum;
              }
              return eSum + Math.abs(e);
            }, 0);
            return sum + recordError;
          }, 0);

          // Warn if invalid data was detected
          if (invalidErrorCount > 0) {
            totalInvalidErrorCount += invalidErrorCount;
            neuronsWithInvalidErrors++;
            console.warn(
              `⚠️  WARNING: Neuron ${neuron.uuid} has ${invalidErrorCount} invalid error values (NaN/Infinity) out of ${
                records.reduce((count, r) => count + r.errors.length, 0)
              } total error values. This indicates a bug in error calculation or data corruption.`,
            );
          }

          // Clear records array to help GC
          records.length = 0;

          // Check if totalError is valid
          if (!Number.isFinite(totalError)) {
            console.error(
              `❌ ERROR: Neuron ${neuron.uuid} has invalid totalError (${totalError}). This should never happen!`,
            );
            return { uuid: neuron.uuid, totalError: 0 };
          }

          return { uuid: neuron.uuid, totalError: totalError };
        } catch (e) {
          console.error(`Error processing neuron ${neuron.uuid}`, e);
          return { uuid: neuron.uuid, totalError: 0 }; // Handle gracefully
        }
      });

      // deno-lint-ignore no-await-in-loop
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Clear batch results to help GC
      batchResults.length = 0;
    }

    // Report summary of invalid data if any was found
    if (totalInvalidErrorCount > 0) {
      console.error(
        `❌ DISCOVERY DATA QUALITY ISSUE: Found ${totalInvalidErrorCount} invalid error values across ${neuronsWithInvalidErrors} neurons (out of ${neurons.length} total)`,
      );
      console.error(
        `   This suggests a bug in creature.record() or error calculation during discovery recording.`,
      );
    }

    return results
      .filter((neuron) => neuron.totalError > 0)
      .sort((a, b) => b.totalError - a.totalError);
  }

  /**
   * Selects a neuron randomly, weighted by total error, favoring neurons with higher errors.
   * Implements "roulette wheel" selection.
   *
   * Reference:
   * - Goldberg, D. E. (1989). Genetic Algorithms in Search, Optimization and Machine Learning.
   */
  public async selectNeuronsWeightedByError(count: number): Promise<string[]> {
    assert(count > 0, "Count must be greater than 0");
    const neuronErrors = await this.listViableNeurons();
    if (neuronErrors.length === 0) return [];

    if (neuronErrors.length <= count) {
      return neuronErrors.map((neuron) => neuron.uuid);
    }
    const selectedUUIDs: Set<string> = new Set();

    const totalErrorSum = neuronErrors.reduce(
      (sum, n) => sum + n.totalError,
      0,
    );

    // Guard against NaN, Infinity, or zero total error
    if (!Number.isFinite(totalErrorSum)) {
      console.error(
        `❌ CRITICAL ERROR: totalErrorSum is ${totalErrorSum} (NaN or Infinity). This indicates corrupt error calculations in the discovery process!`,
      );
      console.error(
        `   Neuron error summary: ${
          neuronErrors.slice(0, 5).map((n) =>
            `${n.uuid.slice(-8)}: ${n.totalError}`
          ).join(", ")
        }...`,
      );
      // Fallback to random selection to prevent infinite loops
      console.warn(
        `   Falling back to random neuron selection to continue discovery`,
      );
      const shuffled = [...neuronErrors].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((n) => n.uuid);
    }

    if (totalErrorSum <= 0) {
      console.warn(
        `⚠️  WARNING: totalErrorSum is ${totalErrorSum} (zero or negative). All neurons have zero error?`,
      );
      console.warn(`   Falling back to random neuron selection`);
      // Fallback to random selection without weighting
      const shuffled = [...neuronErrors].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((n) => n.uuid);
    }

    // Use while loop with max iterations to prevent infinite loops
    // With skewed distributions, we may repeatedly select the same neuron
    // Track stalls and switch to fallback if we're not making progress
    // Base max iterations on the smaller of count or neuronErrors.length
    const maxIterations = Math.min(count, neuronErrors.length) * 100;
    let iterations = 0;
    let stallCount = 0;
    let lastSize = 0;

    // Stall threshold: be aggressive when we have few neurons
    const stallThreshold = Math.min(neuronErrors.length * 3, count * 5);

    while (selectedUUIDs.size < count && iterations < maxIterations) {
      iterations++;
      const randValue = Math.random() * totalErrorSum;
      let cumulativeError = 0;

      for (const neuron of neuronErrors) {
        cumulativeError += neuron.totalError;
        if (randValue <= cumulativeError) {
          selectedUUIDs.add(neuron.uuid);
          break;
        }
      }

      // Detect if we're stalling (not selecting new neurons)
      if (selectedUUIDs.size === lastSize) {
        stallCount++;
        // If we've stalled for too long, switch to hybrid approach
        if (stallCount > stallThreshold) {
          // Fill remaining slots with random selection from unselected neurons
          const unselected = neuronErrors
            .filter((n) => !selectedUUIDs.has(n.uuid))
            .sort(() => Math.random() - 0.5);
          const needed = count - selectedUUIDs.size;
          unselected.slice(0, needed).forEach((n) => selectedUUIDs.add(n.uuid));
          break;
        }
      } else {
        stallCount = 0;
        lastSize = selectedUUIDs.size;
      }
    }

    if (iterations >= maxIterations) {
      console.error(
        `❌ ERROR: Selection reached max iterations (${maxIterations}), only selected ${selectedUUIDs.size}/${count} neurons`,
      );
      console.error(
        `   This should not happen with the hybrid approach. Please report this.`,
      );
      console.error(
        `   totalErrorSum: ${totalErrorSum}, neuronErrors.length: ${neuronErrors.length}`,
      );
    }

    return Array.from(selectedUUIDs);
  }

  /**
   * Entry point for automatic synapse pruning using error-driven analysis.
   * Selects high-error neurons and evaluates their incoming synapses for removal.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @returns A modified Creature with harmful synapse(s) removed, or null if no change was needed.
   */
  async analyzeSynapsesForRemoval(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSynapse | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
    return this.analyzeSelectedNeuronsForRemoval(focusList);
  }

  /**
   * Randomly selects a neuron and evaluates its activation function to identify squash function modifications.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @returns CandidateNeurons with the most promising squash functions modifications.
   */
  async analyzeNeuronsSquashes(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSquash[] | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
    return this.analyzeSelectedNeuronsSquashes(focusList);
  }

  public async analyzeSelectedNeuronsSquashes(
    focusList: string[],
  ): Promise<CandidateSquash[] | undefined> {
    if (focusList.length === 0) return undefined;

    // Check timeout before starting analysis
    if (Date.now() > this.timeoutTS) {
      console.warn(
        `Discovery timeout reached in analyzeSelectedNeuronsSquashes`,
      );
      return undefined;
    }

    const candidatePromises = focusList.map(async (neuronUUID) => {
      const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
      return this.findCandidateSquash(neuronUUID, records);
    });

    return await Promise.all(candidatePromises).then((candidates) => {
      return candidates.filter((candidate) => candidate !== undefined);
    });
  }

  private calculateSquashError(
    idealActivations: number[],
    actualActivations: number[],
  ) {
    const mse = new MSE();
    let totalError = 0;
    for (let i = 0; i < idealActivations.length; i++) {
      const idealActivation = idealActivations[i];
      const actualActivation = actualActivations[i];
      if (actualActivation === undefined) {
        throw new Error("Activation is undefined");
      }
      const error = mse.calculate(
        Float32Array.from([idealActivation]),
        Float32Array.from([actualActivation]),
      );
      totalError += error;
    }

    return totalError / idealActivations.length;
  }

  private findCandidateSquash(
    neuronUUID: string,
    records: DiscoverRecord[],
  ): CandidateSquash | undefined {
    const rawValues: number[] = [];
    const currentActivations: number[] = [];
    const idealActivations: number[] = [];

    records.forEach((record) => {
      const value = record.value;
      if (value === undefined) {
        throw new Error("Value is undefined");
      }
      rawValues.push(value);
      const activation = record.activation;
      if (activation === undefined) {
        throw new Error("Activation is undefined");
      }
      currentActivations.push(activation);
      const errors = record.errors;
      const avgError = errors.length
        ? errors.reduce((a, b) => a + b, 0) / errors.length
        : 0;

      idealActivations.push(activation + avgError);
    });

    const baselineError = this.calculateSquashError(
      idealActivations,
      currentActivations,
    );
    const currentSquash =
      this.creature.neurons.find((neuron) => neuron.uuid === neuronUUID)!
        .squash;
    assert(currentSquash, "Squash function not found");
    let lowestError = baselineError;
    let bestSquash = currentSquash;

    const squashFunctions: ActivationInterface[] = Activations.list().filter(
      (activation) => {
        return (activation as ActivationInterface).squash !== undefined;
      },
    ) as ActivationInterface[];

    // Randomize the order of the squash functions using Fisher-Yates shuffle
    for (let i = squashFunctions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [squashFunctions[i], squashFunctions[j]] = [
        squashFunctions[j],
        squashFunctions[i],
      ];
    }

    for (const squashFunction of squashFunctions) {
      const tempActivations = rawValues.map((value) => {
        return squashFunction.squash(value);
      });
      const newError = this.calculateSquashError(
        idealActivations,
        tempActivations,
      );

      if (newError < lowestError - 0.0001) {
        lowestError = newError;
        bestSquash = squashFunction.getName();
      }
    }

    // Clear large arrays to help GC
    rawValues.length = 0;
    currentActivations.length = 0;
    idealActivations.length = 0;

    if (bestSquash !== currentSquash) {
      const expectedImprovementPercentage = (baselineError - lowestError) /
        baselineError;

      if (expectedImprovementPercentage > 0.01) {
        return {
          neuronUUID,
          previousSquash: currentSquash,
          squash: bestSquash,
          expectedImprovementPercentage: expectedImprovementPercentage,
          improvedError: lowestError,
          currentError: baselineError,
        };
      }
    }

    return undefined;
  }

  /**
   * Removes a synapse from the creature if it is determined to be harmful.
   * This method is used to prune synapses that consistently worsen prediction error.
   * @param ID - Unique identifier for the discovery process.
   * @param creature the Creature instance to modify.
   * @param worseCandidate the candidate synapse to remove.
   * @returns returns a modified Creature with the synapse removed, or null if no change was made.
   */
  public static removeSynapse(
    ID: string,
    creature: Creature,
    worseCandidate?: CandidateSynapse,
  ): Creature | null {
    if (!worseCandidate) return null;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();
    exportJSON.synapses = exportJSON.synapses.filter((synapse) => {
      return synapse.fromUUID !== worseCandidate.fromNeuronUUID ||
        synapse.toUUID !== worseCandidate.toNeuronUUID;
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      addTag(tmpCreature, "discovery", "harmful");
      delete tmpCreature.memetic;
      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return null;
  }

  /**
   * Adds a new synapse to the creature if it improves performance.
   *
   * @param ID - Unique identifier for the discovery process.
   * @param creature - The Creature instance to modify.
   * @param bestCandidate - The candidate synapse to add.
   * @returns A modified Creature with the new synapse added, or null if no change was made.
   */
  public static addHelpfulSynapses(
    ID: string,
    creature: Creature,
    helpfulSynapses?: CandidateSynapse[],
  ): Creature | undefined {
    if (!helpfulSynapses || helpfulSynapses.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    helpfulSynapses.forEach((bestCandidate) => {
      const foundSynapse = exportJSON.synapses.find((synapse) => {
        return synapse.fromUUID === bestCandidate.fromNeuronUUID &&
          synapse.toUUID === bestCandidate.toNeuronUUID;
      });

      if (foundSynapse) return;

      const foundFromNeuron = exportJSON.neurons.find((neuron) => {
        return neuron.uuid === bestCandidate.fromNeuronUUID;
      });
      if (!foundFromNeuron) {
        if (!bestCandidate.fromNeuronUUID.startsWith("input-")) {
          return;
        }
      }
      const foundToNeuron = exportJSON.neurons.find((neuron) => {
        /** may have converted a hidden neuron to a constant */
        if (neuron.type !== "hidden" && neuron.type !== "output") return false;
        return neuron.uuid === bestCandidate.toNeuronUUID;
      });
      if (!foundToNeuron) return;

      const addSynapse = {
        fromUUID: bestCandidate.fromNeuronUUID,
        toUUID: bestCandidate.toNeuronUUID,
        weight: bestCandidate.weight,
      };

      addTag(addSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(addSynapse);
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      addTag(tmpCreature, "discovery", "beneficial");
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
  }

  public static addHelpfulNeurons(
    ID: string,
    creature: Creature,
    helpfulNeurons?: CandidateNeuron[],
  ): Creature | undefined {
    if (!helpfulNeurons || helpfulNeurons.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    const existingNeuronUUIDs = new Set(
      exportJSON.neurons.map((neuron) => neuron.uuid),
    );
    const processedKeys = new Set<string>();
    const addedNeuronUUIDs: string[] = [];

    helpfulNeurons.forEach((candidate) => {
      const key = `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
      if (processedKeys.has(key)) return;
      processedKeys.add(key);

      const sourceExists = existingNeuronUUIDs.has(candidate.fromNeuronUUID) ||
        candidate.fromNeuronUUID.startsWith("input-");
      if (!sourceExists) return;

      const targetNeuron = exportJSON.neurons.find((neuron) => {
        if (neuron.type !== "hidden" && neuron.type !== "output") return false;
        return neuron.uuid === candidate.toNeuronUUID;
      });
      if (!targetNeuron) return;

      const newNeuronUUID =
        `hidden-discovery-${(globalThis.crypto?.randomUUID?.() ??
          `fallback-${Math.random().toString(16).slice(2)}`)}`;
      const newNeuron = {
        type: "hidden" as const,
        uuid: newNeuronUUID,
        squash: candidate.squash,
        bias: candidate.bias,
      };
      addTag(newNeuron as TagsInterface, "discovered", candidate.squash);
      const firstOutputIndex = exportJSON.neurons.findIndex((neuron) =>
        neuron.type === "output"
      );
      if (firstOutputIndex >= 0) {
        exportJSON.neurons.splice(firstOutputIndex, 0, newNeuron);
      } else {
        exportJSON.neurons.push(newNeuron);
      }
      existingNeuronUUIDs.add(newNeuronUUID);
      addedNeuronUUIDs.push(newNeuronUUID);

      const incomingSynapse = {
        fromUUID: candidate.fromNeuronUUID,
        toUUID: newNeuronUUID,
        weight: candidate.incomingWeight,
      };
      addTag(incomingSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(incomingSynapse);

      const outgoingSynapse = {
        fromUUID: newNeuronUUID,
        toUUID: candidate.toNeuronUUID,
        weight: candidate.outgoingWeight,
      };
      addTag(outgoingSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(outgoingSynapse);
    });

    if (addedNeuronUUIDs.length === 0) {
      return;
    }

    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      addTag(tmpCreature, "discovery", "neuron");
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
  }

  /**
   * Adjust the squash function of a neuron to improve its performance.
   *
   * @param ID - Unique identifier for the discovery process.
   * @param creature - The Creature instance to modify.
   * @param bestCandidate - The candidate squash function to apply.
   * @returns A modified Creature with the new modified squash, or null if no change was made.
   */
  public static changeSquash(
    ID: string,
    creature: Creature,
    helpfulSquashes?: CandidateSquash[],
  ): Creature | undefined {
    if (!helpfulSquashes || helpfulSquashes.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    helpfulSquashes.forEach((bestCandidate) => {
      const foundNeuron = exportJSON.neurons.find((neuron) => {
        return neuron.uuid === bestCandidate.neuronUUID;
      });

      if (!foundNeuron) return;
      if (foundNeuron.type !== "hidden" && foundNeuron.type !== "output") {
        return;
      }

      addTag(foundNeuron as TagsInterface, "discovered", bestCandidate.squash);

      foundNeuron.squash = bestCandidate.squash;
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      addTag(tmpCreature, "discovery", "squash");
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
  }

  /**
   * Evaluates all incoming synapses to a set of high-error neurons to identify
   * connections that consistently worsen prediction error.
   *
   * This method considers an existing synapse harmful if its signal correlates
   * with the error direction more often than not.
   *
   * @param focusList - Array of neuron UUIDs to evaluate for synapse pruning.
   * @returns A modified Creature with the worst offending synapse removed, or null if none found.
   */
  public analyzeSelectedNeuronsForRemoval(
    focusList: string[],
  ): Promise<CandidateSynapse | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForRemoval",
      );
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !isRustDiscoveryEnabled()) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          "Rust discovery unavailable; skipping analyzeSelectedNeuronsForRemoval",
        );
      }
      return Promise.resolve(undefined);
    }

    const rustCandidates = this.tryRustHarmfulCandidates(focusList);
    if (!rustCandidates || rustCandidates.length === 0) {
      if (this.loggingEnabled) {
        this.log(
          "debug",
          `Rust harmful synapse analysis returned no candidates for ${
            focusList.join(", ")
          }.`,
        );
      }
      return Promise.resolve(undefined);
    }

    const worstCandidate = rustCandidates[0];
    this.logHarmfulSynapse(worstCandidate);
    return Promise.resolve(worstCandidate);
  }
}
