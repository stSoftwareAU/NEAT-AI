import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { Creature } from "../../Creature.ts";
import type { DataRecordInterface } from "../DataSet.ts";

export interface DiscoverRecord {
  value: number;
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

  constructor(creature: Creature) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    this.tempDir = `.trace/DiscoverStructure/${creature.uuid}`;

    Deno.mkdirSync(this.tempDir, { recursive: true });

    this.creature.neurons.forEach((neuron) => {
      Deno.writeTextFileSync(
        `${this.tempDir}/${neuron.uuid}.csv`,
        "value,activation,errors\n",
      );
    });
  }

  public async cleanUp() {
    await Deno.remove(this.tempDir, { recursive: true });
  }

  public async record(trainingData: DataRecordInterface[]) {
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
            value: this.creature.state.activations[neuron.index],
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
      const csv = records.map((discoverRecord) => {
        return `${discoverRecord.value},${discoverRecord.activation},${discoverRecord.errors}\n`;
      }).join("");
      promises.push(
        Deno.writeTextFile(`${this.tempDir}/${neuronUUID}.csv`, csv, {
          append: true,
        }),
      );
    }
    await Promise.all(promises);
  }

  private discoveries: CandidateSynapse[] = [];

  public async discover(neuronUUID: string) {
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
    const exportedJSON = this.creature.exportJSON();
    for (const discovery of this.discoveries) {
      exportedJSON.synapses.push({
        fromUUID: discovery.fromNeuronUUID,
        toUUID: discovery.toNeuronUUID,
        weight: discovery.weight,
      });
    }
    const newCreature = Creature.fromJSON(exportedJSON);
    newCreature.validate();
    return newCreature;
  }

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    const records = parseCsv(await Deno.readTextFile(file), {
      skipFirstRow: true,
    });
    return records.map((record) => {
      const value = Number.parseFloat(record.value);
      const activation = Number.parseFloat(record.activation);

      assert(Number.isFinite(activation), `Invalid activation ${activation}`);
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
      exportedJSON.synapses.filter((synapse) => synapse.fromUUID === neuronUUID)
        .map((synapse) => synapse.toUUID),
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
    if (fromRecords.length !== activationCount) {
      throw new Error("Mismatched record count");
    }
    if (fromNeuronUUID === "input-33" && toNeuronUUID === "hidden-3") {
      console.log("fromNeuronUUID", fromNeuronUUID);
    }

    let positiveCount = 0;
    let negativeCount = 0;
    let sumAbsActivation = 0;
    let sumAbsError = 0;

    for (let indx = 0; indx < activationCount; indx++) {
      const toRecord = toRecords[indx];
      // const toValue=toRecord.value;
      const fromRecord = fromRecords[indx];
      // const fromValue=fromRecord.value;
      sumAbsActivation += Math.abs(fromRecord.activation);

      let neuronPaths = 0;
      let neuronErrorTotal = 0;
      toRecord.errors.split("|").map((errorTxt) => {
        const error = Number(errorTxt);
        neuronErrorTotal += error;
        neuronPaths++;
        // errorCount++;
      });
      assert(neuronPaths > 0, "neuronPaths must be greater than 0");
      const error = neuronErrorTotal / neuronPaths;

      // toRecord.errors.split("|").map((errorTxt) => {
      //   const error = Number(errorTxt);
      //   errorCount++;
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
      // });
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
