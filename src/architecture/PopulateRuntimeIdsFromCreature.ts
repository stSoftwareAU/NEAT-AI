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
 * **Issue #2546 — forward-only post-condition.** This is the producer gap
 * that #2515 missed: worker training (`WorkerProcessor`), evolution
 * scheduling (`NeatScheduling`), training teardown / outcome / setup,
 * compaction (`CompactUnused`), discovery replay
 * (`ReplayEntryApplication`), knowledge distillation, and the worker→main
 * wire all route through this function. The public {@link exportJSON}
 * already calls {@link assertNoRecurrentSynapseOnForwardOnly}; this
 * internal export did not, and so any forward-only creature that gained a
 * recurrent synapse upstream could be persisted to disk and only surface
 * as a `[loadFrom] Recurrent synapse … source=fromJSON` `TopologyError` on
 * the next worker that ingested the JSON. Mirroring the assertion here
 * pins the producer's stack frame.
 *
 * Repair tools and legacy upgrade paths that legitimately need to
 * serialise a not-yet-repaired creature must call
 * {@link exportJSONWithRuntimeIdsUnchecked} (with a code comment naming
 * the bypass) so the gate's intent is preserved.
 */
export function exportJSONWithRuntimeIds(creature: Creature): CreatureExport {
  assertNoRecurrentSynapseOnForwardOnly(creature, "exportJSONWithRuntimeIds");
  return buildExportWithRuntimeIds(creature);
}

/**
 * Internal-only runtime-ids export that **bypasses** the Issue #2546
 * forward-only assertion. Use only on paths that legitimately need to
 * serialise a potentially-corrupt creature for further processing
 * (e.g. the legacy `upgrade()` / `upgradeTwo()` pipeline before `fix()`
 * finishes its repair pass on residual recurrent edges from 1.x/2.x
 * genomes, and the `NeatScheduling` training-failure diagnostic write
 * already on an error path that must not be masked by another throw).
 *
 * Always pair the call with a code comment naming the bypass — when in
 * doubt, prefer {@link exportJSONWithRuntimeIds}; the assertion is the
 * only thing that names the producing pipeline when corruption escapes
 * onto the worker→main wire or onto disk.
 */
export function exportJSONWithRuntimeIdsUnchecked(
  creature: Creature,
): CreatureExport {
  return buildExportWithRuntimeIds(creature);
}

function buildExportWithRuntimeIds(creature: Creature): CreatureExport {
  // Issue #3088: convertMemeticExportToWireJson deep-clones memetic, so build()
  // attaches it by reference (cloneMemetic=false) to avoid a redundant clone on
  // this per-genome worker→main / breeding hot path.
  const json = new CreatureExportBuilder(creature).build(true, false);
  if (json.memetic) {
    json.memetic = convertMemeticExportToWireJson(creature, json.memetic);
  }
  return json;
}
