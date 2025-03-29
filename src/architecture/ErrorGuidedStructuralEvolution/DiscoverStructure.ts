import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { Creature } from "../../Creature.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import { CreatureUtil } from "../../../mod.ts";
import type { Approach } from "../../NEAT/LogApproach.ts";
import { addTag, removeTag } from "@stsoftware/tags";

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
    assert(this.recorded, "Not recorded");
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
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
      const foundToNeuron = exportJSON.neurons.find((neuron) => {
        return neuron.uuid === bestCandidate.toNeuronUUID;
      });
      if (!foundFromNeuron || !foundToNeuron) return;

      exportJSON.synapses.push({
        fromUUID: bestCandidate.fromNeuronUUID,
        toUUID: bestCandidate.toNeuronUUID,
        weight: bestCandidate.weight,
      });
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      delete tmpCreature.memetic;
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
        `Discovered unhelpful synapse from ${worseCandidate.fromNeuronUUID} to ${worseCandidate.toNeuronUUID}, harming ${
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
