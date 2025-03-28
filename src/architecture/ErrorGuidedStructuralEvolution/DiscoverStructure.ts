import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { Creature } from "../../Creature.ts";
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
interface CandidateSynapse {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  weight: number;
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

/**
 * Implements Error-Driven Synapse Discovery, analyzing neuron activations
 * and errors to identify beneficial new synapses that explicitly reduce neuron-level errors.
 */
export class DiscoverStructure {
  private creature: Creature;
  private tempDir: string;

  private initialized = false;
  private recorded = false;

  constructor(creature: Creature) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    this.tempDir = `.discovery/${creature.uuid}_${
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    }`;

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
        ? "activation,errors\n"
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
    await Deno.remove(this.tempDir, { recursive: true });
  }

  /**
   * Records neuron activations and errors across the provided training data.
   */
  public record(
    trainingData: DataRecordInterface[],
    neuronPromisesMap: Map<string, Promise<void>>,
  ) {
    assert(this.initialized, "Not initialized");
    this.recorded = true;

    this.creature.neurons.forEach((neuron) => {
      if (neuron.type === "input") {
        const dataCSV = trainingData.map((record) => {
          return `${record.input[neuron.index]}\n`;
        }).join("");

        const fileName = `${this.tempDir}/${neuron.uuid}.csv`;
        const previousPromise = neuronPromisesMap.get(neuron.uuid)!;

        const nextPromise = previousPromise.then(() =>
          Deno.writeTextFile(fileName, dataCSV, { append: true, create: false })
        );

        neuronPromisesMap.set(neuron.uuid, nextPromise);
      }
    });

    const data = new Map<string, Array<DiscoverRecord>>();
    trainingData.forEach((record) => {
      this.creature.activate(new Float32Array(record.input));
      const discoverMap = this.creature.record(new Float32Array(record.output));

      this.creature.neurons.forEach((neuron) => {
        if (neuron.type !== "input") {
          const discoverRecord = discoverMap.get(neuron.uuid) || {
            activation: this.creature.state.activations[neuron.index],
            errors: "",
          };
          if (!data.has(neuron.uuid)) {
            data.set(neuron.uuid, []);
          }
          data.get(neuron.uuid)!.push(discoverRecord);
        }
      });
    });

    for (const [neuronUUID, records] of data.entries()) {
      const dataCSV = records.map((discoverRecord) =>
        `${discoverRecord.activation},${discoverRecord.errors}\n`
      ).join("");

      const fileName = `${this.tempDir}/${neuronUUID}.csv`;
      const previousPromise = neuronPromisesMap.get(neuronUUID)!;

      const nextPromise = previousPromise.then(() =>
        Deno.writeTextFile(fileName, dataCSV, { append: true, create: false })
      );

      neuronPromisesMap.set(neuronUUID, nextPromise);
    }
  }

  private discoveries: CandidateSynapse[] = [];

  public async analyzeSelectedNeurons(
    focusList: string[],
  ): Promise<Creature | undefined> {
    if (focusList.length === 0) return undefined;
    const candidatePromises = focusList.map(async (neuronUUID) => {
      const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
      return this.loadCandidateSynapses(neuronUUID, records);
    });

    const candidateArrays = await Promise.all(candidatePromises);
    const allCandidates: CandidateSynapse[] = candidateArrays.flat().filter(
      (candidate) => candidate.expectedImprovementPercentage > 0.1,
    );

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

    const exportedJSON = this.creature.exportJSON();

    const tmpCreature = Creature.fromJSON(exportedJSON);

    for (const discovery of this.discoveries) {
      const fromIndx = tmpCreature.neurons.findIndex((neuron) =>
        neuron.uuid === discovery.fromNeuronUUID
      );
      const toIndx = tmpCreature.neurons.findIndex((neuron) =>
        neuron.uuid === discovery.toNeuronUUID
      );

      tmpCreature.connect(
        fromIndx,
        toIndx,
        discovery.weight,
      );
    }

    tmpCreature.validate();
    return tmpCreature;
  }

  /**
   * Analyzes recorded neuron data to identify and evaluate potential synapse additions.
   */
  public async analyze(): Promise<Creature | undefined> {
    assert(this.recorded, "Not recorded");
    const focusList = await this.selectNeuronsWeightedByError(6);
    return this.analyzeSelectedNeurons(focusList);
  }

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    try {
      const data = await Deno.readTextFile(file);
      const records = parseCsv(data, { skipFirstRow: true });

      return records.map((record, idx) => {
        const activation = Number.parseFloat(record.activation);
        if (isNaN(activation)) {
          throw new Error(`Invalid activation at row ${idx + 2} in ${file}`);
        }
        return { activation, errors: record.errors };
      });
    } catch (e) {
      console.error(`Failed to load or parse CSV file: ${file}`, e);
      throw e; // re-throw after logging for external handling
    }
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
    assert(this.recorded, "Must record first before listing neurons.");

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
    const fromRecords = await this.loadCSV(fileName);
    assert(
      fromRecords.length === activationCount,
      `Mismatched records ${fromRecords.length} != ${activationCount} for ${fileName}`,
    );

    // Track stats for evaluating the benefit of a positive vs. negative weight
    let positiveCount = 0;
    let negativeCount = 0;
    let positiveImprovementSum = 0;
    let negativeImprovementSum = 0;
    let positiveActivationSum = 0;
    let negativeActivationSum = 0;

    // Analyze each training record
    for (let i = 0; i < activationCount; i++) {
      const toRecord = toRecords[i];
      const fromRecord = fromRecords[i];

      const activation = fromRecord.activation;
      if (Math.abs(activation) <= Number.EPSILON) continue;

      // Compute average downstream error
      const errorList = toRecord.errors.split("|").map(Number);
      assert(errorList.length > 0, "neuronPaths must be greater than 0");
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
      activationCount;

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

    return {
      fromNeuronUUID,
      toNeuronUUID,
      weight,
      improvedCount,
      totalCount: activationCount,
      expectedImprovementPercentage,
    };
  }
}
