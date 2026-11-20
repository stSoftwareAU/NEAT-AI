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
 * straight into exports, so the roles survived every substitution. Two entry
 * points close that gap:
 *
 * - {@link clearInwardSynapseRoles} for a live creature, called from
 *   `Neuron.setSquash` when a neuron leaves `IF`.
 * - {@link clearStaleSynapseRoles} for a `CreatureExport`, called by the
 *   Intelligent Design sites that write `squash` into the export.
 *
 * Both judge the squash that will actually be in force, so an output neuron
 * pinned by `Activations.setFixedOutputSquash` is judged by the pin.
 */

import type { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { isRoleReadingTarget } from "@architecture/SynapseKey.ts";
import { normaliseInwardRoles } from "@architecture/CoalesceInwardSynapses.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";

/**
 * Remove the role from every inward synapse of `indx` when that neuron does
 * not read roles, then restore the canonical shape of its inward rows.
 *
 * The scan goes over `creature.synapses` directly rather than the topology
 * caches, so a stale cache cannot hide a typed row.
 *
 * @returns the number of rows whose role was cleared (0 when `indx` is `IF`).
 */
export function clearInwardSynapseRoles(
  creature: Creature,
  indx: number,
): number {
  if (isRoleReadingTarget(creature.neurons, indx)) return 0;

  let cleared = 0;
  for (const synapse of creature.synapses) {
    if (synapse.to !== indx || synapse.type === undefined) continue;
    delete synapse.type;
    cleared++;
  }
  if (cleared === 0) return 0;

  // A role is a hash input, so the cached creature identity is shed here
  // (AGENTS.md: every in-process mutation sheds identity).
  delete creature.uuid;
  creature.clearCache();
  normaliseInwardRoles(creature, indx);
  return cleared;
}

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
