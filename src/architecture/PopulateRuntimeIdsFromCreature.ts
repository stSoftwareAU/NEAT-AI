import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { neuronUuid } from "../neuron/NeuronSerialization.ts";
import { CreatureExportBuilder } from "@utils/CreatureExportBuilder.ts";

/**
 * Populate a local `CreatureExport` clone with the live creature's runtime ids.
 *
 * This is for internal callers that need integer ids to line up with the
 * current in-memory creature instance. Public exports should remain UUID-only.
 */
export function populateRuntimeIdsFromCreature(
  creature: Creature,
  exported: CreatureExport,
): void {
  const wireToId = new Map<string, number>();

  for (let i = 0; i < creature.input; i++) {
    wireToId.set(`input-${i}`, i);
  }

  for (const neuron of creature.neurons) {
    if (neuron.type === "input") continue;
    wireToId.set(neuronUuid(neuron), neuron.id);
  }

  for (const neuron of exported.neurons) {
    if (!neuron.uuid) continue;
    const runtimeId = wireToId.get(neuron.uuid);
    if (runtimeId !== undefined) {
      (neuron as { id?: number }).id = runtimeId;
    }
  }

  for (const synapse of exported.synapses) {
    if (synapse.fromUUID) {
      const fromId = wireToId.get(synapse.fromUUID);
      if (fromId !== undefined) {
        synapse.fromId = fromId;
      }
    }
    if (synapse.toUUID) {
      const toId = wireToId.get(synapse.toUUID);
      if (toId !== undefined) {
        synapse.toId = toId;
      }
    }
  }
}

export function exportJSONWithRuntimeIds(creature: Creature): CreatureExport {
  return new CreatureExportBuilder(creature).build(true);
}
