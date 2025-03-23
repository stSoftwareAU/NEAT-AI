import { assert } from "@std/assert";
import { Creature } from "../../Creature.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import { parse as parseCsv } from "@std/csv";

interface DiscoverRecord {
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
        "activation,errors\n",
      );
    });
  }

  public record(trainingData: DataRecordInterface[]) {
    trainingData.forEach((record) => {
      this.creature.activate(new Float32Array(record.input));
      const errorMap = this.creature.record(new Float32Array(record.output));

      this.creature.neurons.forEach((neuron) => {
        const activation = this.creature.state.activations[neuron.index];
        const errorList = errorMap.get(neuron.uuid);
        let errors = "";
        if (errorList) {
          errors = errorList.join("|");
        }
        Deno.writeTextFileSync(
          `${this.tempDir}/${neuron.uuid}.csv`,
          `${activation},${errors}\n`,
          { append: true },
        );
      });
    });

    //  Record activations and errors per neuron during training for later analysis
  }

  private discoveries: CandidateSynapse[] = [];

  public async discover(neuronUUID: string) {
    const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
    const candidates = await this.loadCandidateSynapses(neuronUUID, records);
    candidates.sort((a, b) =>
      b.expectedErrorReduction - a.expectedErrorReduction
    );
    const bestCandidate = candidates[0];
    if (bestCandidate.expectedErrorReduction > 0) {
      this.discoveries.push(bestCandidate);
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
      const activation = Number(record[0]);
      const errors = record[1];
      return { activation, errors };
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
    for (let indx = 0; indx < exportedJSON.neurons.length; indx++) {
      const neuron = exportedJSON.neurons[indx];
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
    candidateNeuronUUID: string,
    targetNeuronUUID: string,
    candidateRecords: DiscoverRecord[],
  ): Promise<CandidateSynapse> {
    const activationCount = candidateRecords.length;
    let errorCount = 0;
    const targetRecords = await this.loadCSV(
      `${this.tempDir}/${targetNeuronUUID}.csv`,
    );
    if (targetRecords.length !== activationCount) {
      throw new Error("Mismatched record count");
    }

    let positiveImprovement = 0;
    let negativeImprovement = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let sumAbsActivation = 0;
    let sumAbsError = 0;

    for (let indx = 0; indx < activationCount; indx++) {
      const candidateRecord = candidateRecords[indx];
      const targetRecord = targetRecords[indx];
      sumAbsActivation += Math.abs(targetRecord.activation);
      candidateRecord.errors.split("|").map((errorTxt) => {
        const error = Number(errorTxt);
        errorCount++;
        sumAbsError += Math.abs(error);

        if (targetRecord.activation * error < 0) {
          positiveImprovement += Math.abs(error);
          positiveCount++;
        } else if (targetRecord.activation * error > 0) {
          negativeImprovement += Math.abs(error);
          negativeCount++;
        }
      });
    }

    const positiveBetter = positiveImprovement > negativeImprovement;

    const avgAbsActivation = sumAbsActivation / activationCount;
    const avgAbsError = sumAbsError / errorCount;

    const expectedErrorReduction = positiveBetter
      ? positiveImprovement
      : negativeImprovement;

    const weightSign = positiveBetter ? 1 : -1;

    const initialWeightMagnitude = avgAbsError / (avgAbsActivation + 1e-8);

    return {
      fromNeuronUUID: candidateNeuronUUID,
      toNeuronUUID: targetNeuronUUID,
      weight: weightSign * initialWeightMagnitude * 0.1, // small initial weight, *** WHY NOT USE CALCULATED VALUE?
      expectedErrorReduction,
      improvedCount: positiveBetter ? positiveCount : negativeCount,
      totalCount: activationCount,
    };
  }
}
