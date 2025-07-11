import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import type { Creature } from "../Creature.ts";

export class CreatureExportBuilder {
  private readonly creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  build(): CreatureExport {
    const creature = this.creature;
    const neurons = creature.neurons;
    const synapses = creature.synapses;
    const tags = creature.tags ? creature.tags.slice() : undefined;
    const input = creature.input;
    const output = creature.output;
    const neuronsLength = neurons.length;
    const synapsesLength = synapses.length;
    const json: CreatureExport = {
      semanticVersion: creature.semanticVersion,
      neurons: new Array<NeuronExport>(
        neuronsLength - input,
      ),
      synapses: new Array<SynapseExport>(synapsesLength),
      input: input,
      output: output,
      tags: tags,
    };

    const uuidMap = new Map<number, string>();
    for (let i = neuronsLength; i--;) {
      const neuron = neurons[i];
      uuidMap.set(i, neuron.uuid ?? `unknown-${i}`);
      if (neuron.type === "input") continue;

      const tojson = neuron.exportJSON();

      json.neurons[i - input] = tojson;
    }

    for (let i = synapsesLength; i--;) {
      const exportJSON = synapses[i].exportJSON(
        uuidMap,
      );

      json.synapses[i] = exportJSON;
    }

    const memetic = creature.memetic;
    if (memetic) {
      json.memetic = JSON.parse(JSON.stringify(memetic));

      //   const weights = Object.fromEntries(
      //     Object.entries(memetic.weights).map(([key, value]) => [
      //       key,
      //       value.map((weight) => ({ ...weight })),
      //     ]),
      //   );

      //   // Deep clone memetic data efficiently
      //   json.memetic = {
      //     generation: memetic.generation,
      //     score: memetic.score,
      //     biases: { ...memetic.biases },
      //     weights: weights,
      //   };
    }
    return json;
  }
}
