/**
 * @see docs/snapshot-schema.json for the JSON schema describing the export format.
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { type Creature, CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

export class CreatureExportBuilder {
  private readonly creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  /**
   * Build the creature export JSON.
   *
   * @param includeIds When true, includes runtime integer `id` on neurons
   *   and `fromId`/`toId` on synapses. External consumers should use the
   *   default (false) which produces UUID-only output (Issue #2054).
   * @param cloneMemetic When true (default), `memetic` is deep-cloned so the
   *   caller can safely mutate it in place. Callers that hand the export to
   *   {@link convertMemeticExportToWireJson} (the wire path) should pass
   *   `false`: that converter deep-clones memetic itself, so cloning here too
   *   is pure waste (Issue #3088). The export then carries `creature.memetic`
   *   by reference — the wire converter never mutates its input, so the live
   *   creature is never aliased into.
   */
  build(includeIds = false, cloneMemetic = true): CreatureExport {
    const creature = this.creature;
    const neurons = creature.neurons;
    const synapses = creature.synapses;
    const tags = creature.tags ? creature.tags.slice() : undefined;
    const input = creature.input;
    const output = creature.output;
    const neuronsLength = neurons.length;
    const synapsesLength = synapses.length;
    // Issue #2349: defence in depth — never emit an empty semanticVersion.
    const version = creature.semanticVersion ||
      CURRENT_CREATURE_SEMANTIC_VERSION;
    const json: CreatureExport = {
      semanticVersion: version,
      forwardOnly: creature.forwardOnly ? true : undefined,
      neurons: new Array<NeuronExport>(
        neuronsLength - input,
      ),
      synapses: new Array<SynapseExport>(synapsesLength),
      input: input,
      output: output,
      tags: tags,
    };

    const idMap = new Map<number, number>();
    const uuidMap = new Map<number, string>();
    for (let i = neuronsLength; i--;) {
      const neuron = neurons[i];
      idMap.set(i, neuron.id);
      if (neuron.type === "input") {
        uuidMap.set(i, `input-${i}`);
        continue;
      }

      uuidMap.set(i, neuronUuid(neuron));
      const tojson = neuron.exportJSON() as NeuronExport & { id?: number };
      if (includeIds) {
        tojson.id = neuron.id;
      }

      json.neurons[i - input] = tojson;
    }

    for (let i = synapsesLength; i--;) {
      const syn = synapses[i];
      const synExport = syn.exportJSON(idMap, uuidMap);
      if (includeIds) {
        (synExport as SynapseExport & { fromId: number; toId: number })
          .fromId = idMap.get(syn.from)!;
        (synExport as SynapseExport & { fromId: number; toId: number })
          .toId = idMap.get(syn.to)!;
      }

      json.synapses[i] = synExport;
    }

    const memetic = creature.memetic;
    if (memetic) {
      // Issue #3088: only deep-clone when the caller mutates memetic in place
      // (the includeIds → normaliseCreatureExport path). Wire-export callers
      // pass cloneMemetic=false because convertMemeticExportToWireJson clones
      // memetic itself; cloning here as well was a redundant per-export clone.
      json.memetic = cloneMemetic
        ? JSON.parse(JSON.stringify(memetic))
        : memetic;
    }

    // Issue #1863: Export per-creature evolvable hyperparameters
    if (creature.hyperparameters) {
      json.hyperparameters = { ...creature.hyperparameters };
    }

    return json;
  }
}
