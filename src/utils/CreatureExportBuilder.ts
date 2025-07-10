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
    const json: CreatureExport = {
      semanticVersion: creature.semanticVersion,
      neurons: new Array<NeuronExport>(
        neurons.length - creature.input,
      ),
      synapses: new Array<SynapseExport>(synapses.length),
      input: creature.input,
      output: creature.output,
      tags: tags,
    };

    const uuidMap = new Map<number, string>();
    for (let i = neurons.length; i--;) {
      const neuron = neurons[i];
      uuidMap.set(i, neuron.uuid ?? `unknown-${i}`);
      if (neuron.type === "input") continue;

      const tojson = neuron.exportJSON();

      json.neurons[i - this.creature.input] = tojson;
    }

    for (let i = synapses.length; i--;) {
      const exportJSON = synapses[i].exportJSON(
        uuidMap,
      );

      json.synapses[i] = exportJSON;
    }

    if (creature.memetic) {
      json.memetic = JSON.parse(JSON.stringify(creature.memetic));
    }
    return json;
  }
}
