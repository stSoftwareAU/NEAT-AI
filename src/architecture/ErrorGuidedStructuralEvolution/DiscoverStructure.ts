import { assert } from "@std/assert";
import { Creature } from "../../Creature.ts";
import type { DataRecordInterface } from "../DataSet.ts";

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

  public discover() {
    console.log("Discovering structure...", this.tempDir);
    return Creature.fromJSON(this.creature.exportJSON());
  }
}
