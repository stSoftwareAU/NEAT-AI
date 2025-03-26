import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { Creature } from "../../Creature.ts";
import type { DataRecordInterface } from "../DataSet.ts";

export interface DiscoverRecord {
  activation: number;
  errors: string;
}

interface CandidateSynapse {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  weight: number;
  expectedErrorReduction: number;
  expectedImprovementPercentage: number;
  improvedCount: number;
  totalCount: number;
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
    this.tempDir =
      `.discovery/${creature.uuid}/${performance.now()}`;

    Deno.mkdirSync(this.tempDir, { recursive: true });
  }

  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    this.creature.neurons.forEach((neuron) => {
      let headCSV = "activation\n";
      if (neuron.type !== "input") {
        headCSV = "activation,errors\n";
      }

      const writePromise = Deno.writeTextFile(
        `${this.tempDir}/${neuron.uuid}.csv`,
        headCSV,
        {
          append: false,
          createNew: true,
        },
      );
      neuronPromisesMap.set(neuron.uuid, writePromise);
    });
  }

  public async cleanUp() {
    assert(this.initialized, "Not initialized");
    this.initialized = false;
    this.recorded = false;
    this.creature.dispose();
    this.discoveries = [];
    await Deno.remove(this.tempDir, { recursive: true });
  }

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
        const writePromise = Deno.writeTextFile(fileName, dataCSV, {
          append: true,
          create: false,
        })
          .catch((e) => console.error(`Failed write to ${fileName}`, e));

        const neuronPromise = neuronPromisesMap.get(neuron.uuid);
        assert(neuronPromise, "Neuron promise not found");
        neuronPromise.then(async () => await writePromise);
        neuronPromisesMap.set(neuron.uuid, writePromise);
      }
    });

    const data = new Map<
      string,
      Array<DiscoverRecord>
    >();
    trainingData.forEach((record) => {
      this.creature.activate(new Float32Array(record.input));
      const discoverMap = this.creature.record(new Float32Array(record.output));

      this.creature.neurons.forEach((neuron) => {
        if (neuron.type !== "input") {
          let discoverRecord = discoverMap.get(neuron.uuid);
          if (!discoverRecord) {
            discoverRecord = {
              activation: this.creature.state.activations[neuron.index],
              errors: "",
            };
          }
          let array = data.get(neuron.uuid);
          if (!array) {
            array = [];
            data.set(neuron.uuid, array);
          }
          array.push(discoverRecord);
        }
      });
    });

    for (const [neuronUUID, records] of data.entries()) {
      const dataCSV = records.map((discoverRecord) => {
        return `${discoverRecord.activation},${discoverRecord.errors}\n`;
      }).join("");

      const fileName = `${this.tempDir}/${neuronUUID}.csv`;
      const writePromise = Deno.writeTextFile(fileName, dataCSV, {
        append: true,
        create: false,
      })
        .catch((e) => console.error(`Failed write to ${fileName}`, e));

      const neuronPromise = neuronPromisesMap.get(neuronUUID);
      assert(neuronPromise, "Neuron promise not found");
      neuronPromise.then(async () => await writePromise);
      neuronPromisesMap.set(neuronUUID, writePromise);
    }
  }

  private discoveries: CandidateSynapse[] = [];

  public async analyze(neuronUUID: string) {
    assert(this.recorded, "Not recorded");
    const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
    const candidates = await this.loadCandidateSynapses(neuronUUID, records);
    if (candidates.length > 0) {
      candidates.sort((a, b) =>
        b.expectedErrorReduction - a.expectedErrorReduction
      );
      const bestCandidate = candidates[0];
      if (
        bestCandidate.expectedErrorReduction > 0 &&
        bestCandidate.expectedImprovementPercentage > 0.01
      ) {
        const msg =
          `Discovered synapse from ${bestCandidate.fromNeuronUUID} to ${bestCandidate.toNeuronUUID} with weight ${bestCandidate.weight} expected error reduction ${
            bestCandidate.expectedErrorReduction / bestCandidate.totalCount
          } improved ${bestCandidate.improvedCount} of ${bestCandidate.totalCount} (${
            (bestCandidate.expectedImprovementPercentage * 100).toFixed(1)
          }%)`;
        console.info(msg);
        this.discoveries.push(bestCandidate);
      }
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

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    const data = await Deno.readTextFile(file);
    try {
      const records = parseCsv(data, {
        skipFirstRow: true,
      });
      return records.map((record) => {
        const activation = Number.parseFloat(record.activation);

        const errors = record.errors;
        return { activation, errors };
      });
    } catch (e) {
      console.error(`File: ${file}`, e);
      console.info(data);
      throw e;
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

  async analyzeCandidateSynapse(
    toNeuronUUID: string,
    fromNeuronUUID: string,
    toRecords: DiscoverRecord[],
  ): Promise<CandidateSynapse> {
    const activationCount = toRecords.length;

    const fileName = `${this.tempDir}/${fromNeuronUUID}.csv`;
    const fromRecords = await this.loadCSV(
      fileName,
    );
    assert(
      fromRecords.length === activationCount,
      `Mismatched records ${fromRecords.length} != ${activationCount} for ${fileName}`,
    );

    let positiveCount = 0;
    let negativeCount = 0;
    let sumAbsActivation = 0;
    let sumAbsError = 0;
    let totalError = 0;
    let totalActivation = 0;
    for (let indx = 0; indx < activationCount; indx++) {
      const toRecord = toRecords[indx];

      const fromRecord = fromRecords[indx];
      sumAbsActivation += Math.abs(fromRecord.activation);

      let neuronPaths = 0;
      let neuronErrorTotal = 0;
      toRecord.errors.split("|").map((errorTxt) => {
        const error = Number(errorTxt);
        neuronErrorTotal += error;
        neuronPaths++;
        totalActivation += fromRecord.activation;
      });
      assert(neuronPaths > 0, "neuronPaths must be greater than 0");
      const error = neuronErrorTotal / neuronPaths;
      totalError += error;
      sumAbsError += Math.abs(error);
      if (error > 0) {
        if (fromRecord.activation > 0) {
          positiveCount++;
        } else if (fromRecord.activation < 0) {
          negativeCount++;
        }
      } else if (error < 0) {
        if (fromRecord.activation > 0) {
          negativeCount++;
        } else if (fromRecord.activation < 0) {
          positiveCount++;
        }
      }
    }

    const positiveBetter = positiveCount > negativeCount;

    const avgAbsError = sumAbsError / activationCount;
    const avgError = totalError / activationCount;
    const avgActivation = totalActivation / activationCount;
    const initialWeightMagnitude = avgError / (avgActivation + 1e-8);

    let expectedErrorReduction = 0;
    if (positiveBetter) {
      expectedErrorReduction = avgAbsError * (positiveCount - negativeCount);
    } else {
      expectedErrorReduction = avgAbsError * (negativeCount - positiveCount);
    }

    return {
      fromNeuronUUID: fromNeuronUUID,
      toNeuronUUID: toNeuronUUID,
      weight: initialWeightMagnitude,
      expectedErrorReduction,
      improvedCount: positiveBetter ? positiveCount : negativeCount,
      totalCount: activationCount,
      expectedImprovementPercentage: expectedErrorReduction / sumAbsError,
    };
  }
}
