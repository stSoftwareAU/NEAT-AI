import type { TagInterface } from "@stsoftware/tags/mod";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";

/**
 * Creates a shallow clone of a CreatureExport, copying neurons and synapses
 * as new objects to avoid mutation of the original.
 *
 * Issue #1015: This replaces the expensive JSON.parse(JSON.stringify())
 * pattern with direct property copy, which is significantly faster for
 * large networks (500KB+ with 619 neurons + 17,935 synapses).
 *
 * @param source - The CreatureExport to clone
 * @returns A new CreatureExport with independently copied neurons and synapses
 */
export function cloneCreatureExport(source: CreatureExport): CreatureExport {
  // Clone neurons with shallow copy of each neuron object
  const neurons: NeuronExport[] = source.neurons.map((n) => {
    const cloned: NeuronExport = {
      type: n.type,
      bias: n.bias,
    };
    if (n.id !== undefined) (cloned as { id?: number }).id = n.id;
    if (n.uuid !== undefined) (cloned as { uuid?: string }).uuid = n.uuid;
    if (n.squash !== undefined) cloned.squash = n.squash;
    if (n.tags !== undefined) {
      cloned.tags = [...n.tags] as TagInterface[];
    }
    return cloned;
  });

  // Clone synapses with shallow copy of each synapse object
  const synapses: SynapseExport[] = source.synapses.map((s) => {
    const cloned: SynapseExport = {
      weight: s.weight,
    };
    if (s.fromId !== undefined) {
      (cloned as { fromId?: number }).fromId = s.fromId;
    }
    if (s.toId !== undefined) (cloned as { toId?: number }).toId = s.toId;
    if (s.fromUUID !== undefined) cloned.fromUUID = s.fromUUID;
    if (s.toUUID !== undefined) cloned.toUUID = s.toUUID;
    if (s.type !== undefined) cloned.type = s.type;
    if (s.tags !== undefined) {
      cloned.tags = [...s.tags] as TagInterface[];
    }
    return cloned;
  });

  // Build the cloned creature export
  const cloned: CreatureExport = {
    input: source.input,
    output: source.output,
    neurons,
    synapses,
  };

  // Copy optional top-level properties
  if (source.forwardOnly !== undefined) cloned.forwardOnly = source.forwardOnly;
  if (source.semanticVersion !== undefined) {
    cloned.semanticVersion = source.semanticVersion;
  }
  if (source.memetic !== undefined) {
    // Shallow copy of memetic - the nested structures are treated as immutable
    cloned.memetic = { ...source.memetic };
  }
  if (source.tags !== undefined) {
    cloned.tags = [...source.tags] as TagInterface[];
  }

  return cloned;
}
