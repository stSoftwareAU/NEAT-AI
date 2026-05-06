import type { Creature } from "@creature";
import { convertMemeticExportToWireJson } from "@creature/MemeticWireExport.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { assertNoRecurrentSynapseOnForwardOnly } from "@architecture/ForwardOnlyAssertion.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";
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

/**
 * Internal export with runtime integer ids on neurons and synapses.
 *
 * **Issue #2546 — forward-only post-condition.** This is the producer
 * gap that #2515 missed: worker training (`WorkerProcessor`), evolution
 * scheduling (`NeatScheduling`), training teardown / outcome / setup,
 * compaction (`CompactUnused`), discovery replay
 * (`ReplayEntryApplication`), knowledge distillation, and the legacy
 * upgrade pipeline all route through this function. The public
 * {@link exportJSON} already calls
 * {@link assertNoRecurrentSynapseOnForwardOnly}; this internal export
 * did not, and so any forward-only creature that gained a recurrent
 * synapse upstream could be persisted to disk and only surface as a
 * `[loadFrom] Recurrent synapse … source=fromJSON` `TopologyError` on
 * the next worker that ingested the JSON. Mirroring the assertion here
 * pins the producer's stack frame.
 *
 * Pre-4.x upgrade paths are not affected: the `forwardOnly` flag was
 * introduced with 4.x, so 1.x/2.x/3.x creatures arriving in the upgrade
 * pipeline have `forwardOnly !== true` and the assertion is a no-op.
 */
export function exportJSONWithRuntimeIds(creature: Creature): CreatureExport {
  assertNoRecurrentSynapseOnForwardOnly(creature, "exportJSONWithRuntimeIds");
  const json = new CreatureExportBuilder(creature).build(true);
  if (json.memetic) {
    json.memetic = convertMemeticExportToWireJson(creature, json.memetic);
  }
  return json;
}
