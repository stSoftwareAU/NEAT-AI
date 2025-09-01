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
  errors: string;
  value?: number;
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

/**
 * Represents a neuron and its total accumulated error for ranking neurons during discovery.
 */
interface NeuronErrorInfo {
  uuid: string;
  totalError: number;
}

/**
 * Implements Error-Driven Synapse Discovery, analyzing neuron activations
 * and errors to identify beneficial new synapses that explicitly reduce neuron-level errors.
 */
export class DiscoverStructure {
  private creature: Creature;
  private tempDir: string;
  private textDecoder: TextDecoder;
  private timeoutTS: number;

  private initialized = false;
  private recorded = false;

  constructor(creature: Creature, timeoutSeconds: number) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    this.tempDir = `.discovery/${creature.uuid}_${
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    }`;
    this.textDecoder = new TextDecoder();
    assert(timeoutSeconds > 0, "Timeout seconds must be greater than 0");
    assert(
      timeoutSeconds < 60 * 60,
      "Timeout seconds must be less than 1 hour",
    );
    this.timeoutTS = Date.now() + timeoutSeconds * 1000;

    Deno.mkdirSync(this.tempDir, { recursive: true });
  }

  /**
   * Initializes the discovery process by preparing temporary storage for neuron data.
   */
  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    this.creature.neurons.forEach((neuron) => {
      const headCSV = neuron.type !== "input"
        ? "value,activation,errors\n"
        : "activation\n";
      const filePath = `${this.tempDir}/${neuron.uuid}.csv`;

      const writePromise = Deno.writeTextFile(filePath, headCSV, {
        append: false,
        createNew: true,
      });

      neuronPromisesMap.set(neuron.uuid, writePromise);
    });
  }

  /**
   * Cleans up temporary resources and resets the internal state after discovery.
   */
  public async cleanUp() {
    assert(this.initialized, "Not initialized");
    this.initialized = false;
    this.recorded = false;
    this.creature.dispose();
    this.discoveries = [];

    // Clear references to help GC
    // @ts-ignore - clearing to help GC
    this.creature = null;
    // @ts-ignore - clearing to help GC
    this.discoveries = null;

    try {
      await Deno.remove(this.tempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors to prevent crashes
      console.warn(`Failed to cleanup discovery temp dir: ${error}`);
    }
  }

  /**
   * Records neuron activations and errors across the provided training data.
   * Optimized for memory efficiency and performance.
   */
  public record(
    trainingData: DataRecordInterface[],
    neuronPromisesMap: Map<string, Promise<void>>,
  ): boolean {
    assert(this.initialized, "Not initialized");
    if (Date.now() > this.timeoutTS) {
      return false;
    }
    this.recorded = true;

    // Process input neurons first (simpler, no activation needed)
    this.creature.neurons.forEach((neuron) => {
      if (neuron.type === "input") {
        // Build CSV string directly without intermediate array
        let dataCSV = "";
        for (let i = 0; i < trainingData.length; i++) {
          dataCSV += `${trainingData[i].input[neuron.index]}\n`;
        }

        const fileName = `${this.tempDir}/${neuron.uuid}.csv`;
        const previousPromise = neuronPromisesMap.get(neuron.uuid)!;

        const nextPromise = previousPromise.then(() =>
          Deno.writeTextFile(fileName, dataCSV, { append: true, create: false })
        );

        neuronPromisesMap.set(neuron.uuid, nextPromise);
      }
    });

    // Process non-input neurons with streaming approach
    const nonInputNeurons = this.creature.neurons.filter((neuron) =>
      neuron.type !== "input"
    );

    // Pre-allocate CSV builders for each neuron to avoid repeated string concatenation
    const csvBuilders = new Map<string, string[]>();
    nonInputNeurons.forEach((neuron) => {
      csvBuilders.set(neuron.uuid, []);
    });

    // Process each record and build CSV data incrementally
    for (let i = 0; i < trainingData.length; i++) {
      const record = trainingData[i];

      // Activate creature with existing input (no new Float32Array creation)
      this.creature.activate(record.input);
      const discoverMap = this.creature.record(record.output);

      // Build CSV lines for each neuron
      nonInputNeurons.forEach((neuron) => {
        const discoverRecord = discoverMap.get(neuron.uuid) || {
          activation: this.creature.state.activations[neuron.index],
          errors: "",
        };

        const csvLine = `${
          discoverRecord.value ?? ""
        },${discoverRecord.activation},${discoverRecord.errors}\n`;
        csvBuilders.get(neuron.uuid)!.push(csvLine);
      });

      if (Date.now() > this.timeoutTS) {
        break;
      }
    }

    // Write CSV data for each neuron
    for (const [neuronUUID, csvLines] of csvBuilders.entries()) {
      const dataCSV = csvLines.join("");
      const fileName = `${this.tempDir}/${neuronUUID}.csv`;
      const previousPromise = neuronPromisesMap.get(neuronUUID)!;

      const nextPromise = previousPromise.then(() =>
        Deno.writeTextFile(fileName, dataCSV, { append: true, create: false })
      );

      neuronPromisesMap.set(neuronUUID, nextPromise);
    }

    // Clear CSV builders to help GC
    csvBuilders.clear();
    return true;
  }

  private discoveries: CandidateSynapse[] = [];

  public async analyzeSelectedNeurons(
    focusList: string[],
  ): Promise<CandidateSynapse[] | undefined> {
    if (focusList.length === 0) return undefined;

    const candidatePromises = focusList.map(async (neuronUUID) => {
      const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
      return this.loadCandidateSynapses(neuronUUID, records);
    });

    const candidateArrays = await Promise.all(candidatePromises);
    const allCandidates: CandidateSynapse[] = candidateArrays.flat().filter(
      (candidate) => candidate.expectedImprovementPercentage > 0.1,
    );

    // Clear large arrays to help GC
    candidateArrays.length = 0;

    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) =>
        b.expectedImprovementPercentage - a.expectedImprovementPercentage
      );
      const bestCandidate = allCandidates[0];
      assert(bestCandidate.expectedImprovementPercentage > 0);

      console.info(
        `Discovered beneficial synapse from ${bestCandidate.fromNeuronUUID} to ${bestCandidate.toNeuronUUID} with weight ${
          bestCandidate.weight.toFixed(4)
        }, helping ${
          (
            bestCandidate.expectedImprovementPercentage * 100
          ).toFixed(1)
        }% more records than it harms (${bestCandidate.improvedCount}/${bestCandidate.totalCount})`,
      );

      this.discoveries.push(bestCandidate);
    }

    if (this.discoveries.length === 0) {
      return undefined;
    }

    return this.discoveries;
  }

  /**
   * Analyzes recorded neuron data to identify and evaluate potential synapse additions.
   */
  public async analyze(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSynapse[] | undefined> {
    if (this.recorded === false) {
      console.warn("No recorded data to analyze.");
      return undefined;
    }
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
    return this.analyzeSelectedNeurons(focusList);
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

    return { value, activation, errors: record.errors };
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

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    const fileInfo = await Deno.stat(file);
    assert(fileInfo.isFile, "Not a file");

    const records: DiscoverRecord[] = [];
    const headers: string[] = [];
    let isFirstChunk = true;

    // Process the file in chunks to avoid memory issues
    const bufferSize = 10 * 1024; // Was 256k
    const buffer = new Uint8Array(bufferSize);
    let partialLine = "";

    // Open file for streaming with retry mechanism
    const fileHandle = await this.openFileWithRetry(file);
    try {
      // We need to process chunks sequentially to maintain record order
      while (true) {
        const bytesRead = fileHandle.readSync(buffer);
        if (bytesRead === null) {
          break;
        }
        assert(bytesRead > 0, "Invalid number of bytes read");

        // Convert buffer to string and process
        const chunk = this.textDecoder.decode(buffer.slice(0, bytesRead));

        partialLine = this.processCSVChunk(
          chunk,
          partialLine,
          headers,
          isFirstChunk,
          records,
        );

        isFirstChunk = false;

        // Give GC a chance to run periodically
        if (records.length % 1000 === 0) {
          // deno-lint-ignore no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      if (partialLine.trim()) {
        assert(headers.length > 0, "No headers found");
        const values = parseCsv(partialLine, { skipFirstRow: false })[0];

        const record = this.processCSVRecord(headers, values);
        if (record) {
          records.push(record);
        }
      }
    } finally {
      fileHandle.close();
      // Buffer will be garbage collected when it goes out of scope
    }

    return records;
  }

  private async loadCandidateSynapses(
    neuronUUID: string,
    records: DiscoverRecord[],
  ): Promise<CandidateSynapse[]> {
    const exportedJSON = this.creature.exportJSON();
    const currentSynapses = new Set<string>(
      exportedJSON.synapses.filter((synapse) => synapse.toUUID === neuronUUID)
        .map((synapse) => synapse.fromUUID),
    );

    const promises: Promise<CandidateSynapse>[] = [];
    for (let indx = 0; indx < this.creature.neurons.length; indx++) {
      const neuron = this.creature.neurons[indx];
      if (neuron.uuid === neuronUUID) {
        break;
      }
      if (currentSynapses.has(neuron.uuid)) {
        continue;
      }

      const p = this.analyzeCandidateSynapse(neuronUUID, neuron.uuid, records);
      promises.push(p);
    }
    const candidates = await Promise.all(promises);

    return candidates;
  }

  /**
   * Lists neurons sorted by their total error, useful for error-driven selection processes.
   */
  public async listViableNeurons(): Promise<NeuronErrorInfo[]> {
    if (!this.recorded) {
      console.warn("No recorded data to list neurons.");
      return [];
    }

    const neuronPromises = this.creature.neurons
      .filter((neuron) => neuron.type !== "input")
      .map(async (neuron) => {
        try {
          const records = await this.loadCSV(
            `${this.tempDir}/${neuron.uuid}.csv`,
          );

          const totalError = records.reduce((sum, record) => {
            const errors = record.errors.split("|").map(Number);
            const recordError = errors.reduce(
              (eSum, e) => eSum + Math.abs(e),
              0,
            );
            return sum + recordError;
          }, 0);

          // Clear records array to help GC
          records.length = 0;

          return { uuid: neuron.uuid, totalError };
        } catch (e) {
          console.error(`Error processing neuron ${neuron.uuid}`, e);
          return { uuid: neuron.uuid, totalError: 0 }; // Handle gracefully
        }
      });

    const neuronErrors = await Promise.all(neuronPromises);

    return neuronErrors
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

    for (let i = 0; i < count; i++) {
      const randValue = Math.random() * totalErrorSum;
      let cumulativeError = 0;

      for (const neuron of neuronErrors) {
        cumulativeError += neuron.totalError;
        if (randValue <= cumulativeError) {
          selectedUUIDs.add(neuron.uuid);
          break;
        }
      }
    }

    return Array.from(selectedUUIDs);
  }

  /**
   * Analyzes a candidate synapse by estimating the potential reduction in downstream error
   * if the synapse were added. It evaluates whether a positive or negative weight would
   * lead to a net improvement, and calculates the initial weight accordingly.
   *
   * @param toNeuronUUID - UUID of the target neuron the synapse would connect to
   * @param fromNeuronUUID - UUID of the source neuron the synapse would originate from
   * @param toRecords - Activation/error records for the target neuron
   * @returns A CandidateSynapse representing the most promising synapse addition
   */
  async analyzeCandidateSynapse(
    toNeuronUUID: string,
    fromNeuronUUID: string,
    toRecords: DiscoverRecord[],
  ): Promise<CandidateSynapse> {
    const activationCount = toRecords.length;

    // Load source neuron activation records
    const fileName = `${this.tempDir}/${fromNeuronUUID}.csv`;
    let fromRecords = await this.loadCSV(fileName);

    // Handle mismatched record counts more gracefully
    if (fromRecords.length !== activationCount) {
      // Use the smaller count to avoid index out of bounds errors
      const minCount = Math.min(fromRecords.length, activationCount);
      toRecords = toRecords.slice(0, minCount);
      fromRecords = fromRecords.slice(0, minCount);
    }

    // Track stats for evaluating the benefit of a positive vs. negative weight
    let positiveCount = 0;
    let negativeCount = 0;
    let positiveImprovementSum = 0;
    let negativeImprovementSum = 0;
    let positiveActivationSum = 0;
    let negativeActivationSum = 0;

    // Analyze each training record
    for (let i = 0; i < toRecords.length; i++) {
      const toRecord = toRecords[i];
      const fromRecord = fromRecords[i];

      const activation = fromRecord.activation;
      if (Math.abs(activation) <= Number.EPSILON) continue;

      // Compute average downstream error
      const errorList = toRecord.errors.split("|").map(Number);
      if (errorList.length === 0) continue; // Skip if no errors

      const avgError = errorList.reduce((a, b) => a + b, 0) / errorList.length;

      if (Math.abs(avgError) <= Number.EPSILON) continue;

      // Determine if a positive or negative weight would reduce the error
      const requiredWeightSign = -Math.sign(avgError) * Math.sign(activation);
      const improvement = Math.abs(avgError);

      if (requiredWeightSign > 0) {
        positiveCount++;
        positiveImprovementSum += improvement;
        positiveActivationSum += Math.abs(activation);
      } else if (requiredWeightSign < 0) {
        negativeCount++;
        negativeImprovementSum += improvement;
        negativeActivationSum += Math.abs(activation);
      }
    }

    // Clear fromRecords array to help GC
    fromRecords.length = 0;

    // Determine the better weight direction
    const usePositive = positiveCount >= negativeCount;
    const improvedCount = usePositive ? positiveCount : negativeCount;
    const worsenCount = usePositive ? negativeCount : positiveCount;
    const improvementSum = usePositive
      ? positiveImprovementSum
      : negativeImprovementSum;
    const activationSum = usePositive
      ? positiveActivationSum
      : negativeActivationSum;

    // Net percentage improvement: positive means overall help, negative means harm
    const expectedImprovementPercentage = (improvedCount - worsenCount) /
      toRecords.length;

    // Estimate weight magnitude and apply correct sign
    let weight = 0;
    if (improvedCount > 0 && activationSum > Number.EPSILON) {
      const rawWeight = improvementSum / (activationSum + 1e-8);

      // Flip sign because activationSum is always positive.
      // If positive weight is better, weight must oppose activation to reduce error.
      weight = usePositive ? -rawWeight : rawWeight;

      // Clamp weight for stability
      weight = Math.max(-1, Math.min(1, weight));
    }

    const totalCount = toRecords.length;

    return {
      fromNeuronUUID,
      toNeuronUUID,
      weight,
      improvedCount,
      totalCount: totalCount,
      expectedImprovementPercentage,
    };
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
      const errors = record.errors.split("|").map(Number);
      const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;

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
   * Analyzes an existing synapse to estimate whether it contributes to increased downstream error.
   *
   * A synapse is considered harmful if the product of its signal (activation × weight)
   * aligns with the direction of the observed error (i.e., it reinforces the error).
   *
   * @param toNeuronUUID - UUID of the downstream neuron receiving the signal.
   * @param fromNeuronUUID - UUID of the upstream neuron sending the signal.
   * @param toRecords - Activation and error records for the target neuron.
   * @param weight - The existing weight of the synapse to evaluate.
   * @returns A CandidateSynapse with the measured error impact of this existing synapse.
   */
  async analyzeExistingSynapseImpact(
    toNeuronUUID: string,
    fromNeuronUUID: string,
    toRecords: DiscoverRecord[],
    weight: number,
  ): Promise<CandidateSynapse> {
    const activationCount = toRecords.length;
    const fileName = `${this.tempDir}/${fromNeuronUUID}.csv`;
    const fromRecords = await this.loadCSV(fileName);
    assert(
      fromRecords.length === activationCount,
      `Mismatched records ${fromRecords.length} != ${activationCount} for ${fileName}`,
    );

    let harmfulCount = 0;
    let helpfulCount = 0;
    let errorImpactSum = 0;

    for (let i = 0; i < activationCount; i++) {
      const toRecord = toRecords[i];
      const fromRecord = fromRecords[i];

      const activation = fromRecord.activation;
      if (Math.abs(activation) <= Number.EPSILON) continue;

      const errorList = toRecord.errors.split("|").map(Number);
      const avgError = errorList.reduce((a, b) => a + b, 0) / errorList.length;
      if (Math.abs(avgError) <= Number.EPSILON) continue;

      const signal = activation * weight;
      const signMatch = Math.sign(signal) === Math.sign(avgError);

      if (signMatch) {
        harmfulCount++;
        errorImpactSum += Math.abs(avgError);
      } else {
        helpfulCount++;
      }
    }

    // Clear fromRecords array to help GC
    fromRecords.length = 0;

    const expectedHarmPercentage = (harmfulCount - helpfulCount) /
      activationCount;

    return {
      fromNeuronUUID,
      toNeuronUUID,
      weight,
      improvedCount: harmfulCount,
      totalCount: activationCount,
      expectedImprovementPercentage: expectedHarmPercentage,
    };
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
      return synapse.fromUUID !== worseCandidate.fromNeuronUUID &&
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
  public async analyzeSelectedNeuronsForRemoval(
    focusList: string[],
  ): Promise<CandidateSynapse | undefined> {
    if (focusList.length === 0) return undefined;

    const promises: Promise<CandidateSynapse>[] = [];
    const exportJSON = this.creature.exportJSON();

    const candidatePromises = focusList.map(async (toUUID) => {
      const records = await this.loadCSV(`${this.tempDir}/${toUUID}.csv`);
      exportJSON.synapses.map((synapse) => {
        if (synapse.toUUID === toUUID) {
          const p = this.analyzeExistingSynapseImpact(
            toUUID,
            synapse.fromUUID,
            records,
            synapse.weight,
          );

          promises.push(p);
        }
      });
    });
    await Promise.all(candidatePromises);

    const candidates = await Promise.all(promises);
    const allCandidates: CandidateSynapse[] = candidates.filter(
      (candidate) => candidate.expectedImprovementPercentage < -0.1,
    );

    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) =>
        a.expectedImprovementPercentage - b.expectedImprovementPercentage
      );
      const worseCandidate = allCandidates[0];
      assert(worseCandidate.expectedImprovementPercentage < 0);

      console.info(
        `Discovered harmful synapse from ${worseCandidate.fromNeuronUUID} to ${worseCandidate.toNeuronUUID}, harming ${
          (
            -1 * worseCandidate.expectedImprovementPercentage * 100
          ).toFixed(1)
        }% more records than it helps (${worseCandidate.improvedCount}/${worseCandidate.totalCount})`,
      );

      return worseCandidate;
    }

    return undefined;
  }
}
