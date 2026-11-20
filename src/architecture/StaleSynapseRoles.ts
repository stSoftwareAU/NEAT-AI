/**
 * @module
 *
 * Clear the roles (`condition` / `positive` / `negative`) that a neuron no
 * longer reads when it stops being an `IF` (Issue #4185).
 *
 * Only an `IF` target reads roles. A neuron changed to any other squash that
 * keeps its typed inward rows leaves roles that mean nothing, and two rows from
 * one source into a non-`IF` neuron are a validator error
 * (`duplicate-synapse-roles-into-non-if`). Intelligent Design wrote `squash`
 * straight into exports, so the roles survived every substitution.
 *
 * - {@link clearStaleSynapseRoles} for a `CreatureExport`, called by the
 *   Intelligent Design sites that write `squash` into the export. It judges the
 *   squash that will actually be in force, so an output neuron pinned by
 *   `Activations.setFixedOutputSquash` is judged by the pin.
 *
 * The live-creature counterpart is `Neuron.setSquash`, which calls
 * `stripRolesAndCoalesceSources` (`RepairInvalidIfNeurons.ts`) when a neuron
 * leaves `IF`.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";

/**
 * Remove the role from the inward synapses of one neuron in a
 * `CreatureExport`, after its squash has been written into the export.
 *
 * The neuron's effective squash decides it: for an output neuron that is the
 * active output-squash pin when one is set, otherwise the squash in the export.
 * An effective `IF` neuron is left alone. For any other neuron, rows into it
 * that now share a source are summed into the first such row, with tags
 * merged. Only rows into this neuron are touched.
 *
 * Per-target and idempotent, so it may be called once per substitution in any
 * order.
 *
 * @returns the number of roles cleared.
 * @throws Error when no neuron in the export has `neuronUuid`.
 */
export function clearStaleSynapseRoles(
  creatureExport: CreatureExport,
  neuronUuid: string,
): number {
  const neuron = creatureExport.neurons.find((n) => n.uuid === neuronUuid);
  if (!neuron) {
    throw new Error(
      `Neuron with UUID ${neuronUuid} not found in the creature export`,
    );
  }

  const effective = neuron.type === "output"
    ? Activations.getFixedOutputSquash() ?? neuron.squash
    : neuron.squash;
  if (effective === "IF") return 0;

  const targets = creatureExport.synapses.filter((s) =>
    s.toUUID === neuronUuid ||
    (s.toUUID === undefined && neuron.id !== undefined && s.toId === neuron.id)
  );

  let cleared = 0;
  for (const synapse of targets) {
    if (synapse.type === undefined) continue;
    delete synapse.type;
    cleared++;
  }

  const first = new Map<string, SynapseExport>();
  const merged = new Set<SynapseExport>();
  for (const synapse of targets) {
    const key = synapse.fromUUID ?? `id:${synapse.fromId}`;
    const kept = first.get(key);
    if (kept === undefined) {
      first.set(key, synapse);
      continue;
    }
    kept.weight += synapse.weight;
    if (synapse.tags?.length) {
      kept.tags = mergeTagsByNameValue(kept.tags, synapse.tags);
    }
    merged.add(synapse);
  }

  if (merged.size > 0) {
    creatureExport.synapses = creatureExport.synapses.filter((s) =>
      !merged.has(s)
    );
  }
  return cleared;
}
