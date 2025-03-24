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
    this.tempDir = `.trace/DiscoverStructure/${creature.uuid}`;

    Deno.mkdirSync(this.tempDir, { recursive: true });
  }

  public async initialize() {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;
    const headCSV = "activation,errors\n";

    const promises: Promise<void>[] = [];
    this.creature.neurons.forEach((neuron) => {
      const writePromise = Deno.writeTextFile(
        `${this.tempDir}/${neuron.uuid}.csv`,
        headCSV,
      );
      promises.push(writePromise);
    });
    await Promise.all(promises);
  }

  public async cleanUp() {
    await Deno.remove(this.tempDir, { recursive: true });
  }

  public async record(trainingData: DataRecordInterface[]) {
    assert(this.initialized, "Not initialized");
    this.recorded = true;
    const data = new Map<
      string,
      Array<DiscoverRecord>
    >();
    trainingData.forEach((record) => {
      this.creature.activate(new Float32Array(record.input));
      const discoverMap = this.creature.record(new Float32Array(record.output));

      this.creature.neurons.forEach((neuron) => {
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
      });
    });

    const promises: Promise<void>[] = [];
    for (const [neuronUUID, records] of data.entries()) {
      const dataCSV = records.map((discoverRecord) => {
        return `${discoverRecord.activation},${discoverRecord.errors}\n`;
      }).join("");

      const fileName = `${this.tempDir}/${neuronUUID}.csv`;
      const writePromise = Deno.writeTextFile(fileName, dataCSV, {
        append: true,
      })
        .catch((e) => console.error(`Failed write to ${fileName}`, e));

      promises.push(writePromise);
    }
    await Promise.all(promises);
  }

  private discoveries: CandidateSynapse[] = [];

  public async discover(neuronUUID: string) {
    assert(this.recorded, "Not recorded");
    const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
    const candidates = await this.loadCandidateSynapses(neuronUUID, records);
    if (candidates.length > 0) {
      candidates.sort((a, b) =>
        b.expectedErrorReduction - a.expectedErrorReduction
      );
      const bestCandidate = candidates[0];
      if (bestCandidate.expectedErrorReduction > 0) {
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
    const records = parseCsv(await Deno.readTextFile(file), {
      skipFirstRow: true,
    });
    return records.map((record) => {
      const value = Number.parseFloat(record.value);
      const activation = Number.parseFloat(record.activation);

      const errors = record.errors;
      return { value, activation, errors };
    });
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

    const fromRecords = await this.loadCSV(
      `${this.tempDir}/${fromNeuronUUID}.csv`,
    );
    assert(fromRecords.length === activationCount, "Mismatched record count");

    let positiveCount = 0;
    let negativeCount = 0;
    let sumAbsActivation = 0;
    let sumAbsError = 0;

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
      });
      assert(neuronPaths > 0, "neuronPaths must be greater than 0");
      const error = neuronErrorTotal / neuronPaths;

      sumAbsError += Math.abs(error);
      if (error > 0) {
        if (fromRecord.activation > 0) {
          negativeCount++;
        } else if (fromRecord.activation < 0) {
          positiveCount++;
        }
      } else if (error < 0) {
        if (fromRecord.activation > 0) {
          positiveCount++;
        } else if (fromRecord.activation < 0) {
          negativeCount++;
        }
      }
    }

    const positiveBetter = positiveCount > negativeCount;

    const avgAbsActivation = sumAbsActivation / activationCount;
    const avgAbsError = sumAbsError / activationCount;

    const initialWeightMagnitude = avgAbsError / (avgAbsActivation + 1e-8);

    let expectedErrorReduction = 0;
    if (positiveBetter) {
      expectedErrorReduction = avgAbsError * (positiveCount - negativeCount);
    } else {
      expectedErrorReduction = avgAbsError * (negativeCount - positiveCount);
    }

    const weightSign = positiveBetter ? 1 : -1;

    return {
      fromNeuronUUID: fromNeuronUUID,
      toNeuronUUID: toNeuronUUID,
      weight: weightSign * initialWeightMagnitude,
      expectedErrorReduction,
      improvedCount: positiveBetter ? positiveCount : negativeCount,
      totalCount: activationCount,
    };
  }
}
