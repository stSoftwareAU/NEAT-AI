import { getTag, removeTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Restore grafted neuron identities on a freshly bred offspring export.
 *
 * During incompatible crossover, {@link editParentByIndex} renames a parent's
 * unmatched hidden neurons to the *other* parent's UUIDs and records the
 * original UUID in an `alias` tag. After breeding we reverse that rename so the
 * offspring keeps its own neuron identities rather than colliding with the
 * grafted-onto parent.
 *
 * Issue #2746: the naive rewrite blindly set `neuron.uuid = alias`. When the
 * restored alias collided with a UUID already present elsewhere in the
 * offspring, `loadFrom` mapped that UUID to a single index and re-pointed the
 * other neuron's synapses at it. On a forward-only creature this turned a
 * forward edge into a recurrent one (`from >= to`), tripping the
 * `breed:fixAliases` recurrent-synapse `TopologyError` (and a downstream stack
 * overflow). We now only restore an alias when it does not collide with an
 * existing UUID, keeping the deduplicated identity otherwise.
 *
 * Mutates `fixed` in place.
 */
export function restoreGraftAliases(fixed: CreatureExport): void {
  // UUIDs that will remain after restoration: every neuron's current UUID,
  // seeded so collision checks see the full graph. As aliases are restored we
  // swap the old UUID out for the alias.
  const occupied = new Set<string>();
  for (const n of fixed.neurons) {
    if (typeof n.uuid === "string") occupied.add(n.uuid);
  }

  for (const n of fixed.neurons) {
    const alias = getTag(n, "alias");
    if (!alias || typeof n.uuid !== "string") continue;

    removeTag(n, "alias");
    const oldUuid = n.uuid;
    if (alias === oldUuid) continue;

    // Skip restoration when the alias is already taken by another neuron.
    // Restoring it would create a duplicate UUID and mis-wire synapses.
    if (occupied.has(alias)) continue;

    occupied.delete(oldUuid);
    occupied.add(alias);
    n.uuid = alias;
    for (const s of fixed.synapses) {
      if (s.fromUUID === oldUuid) s.fromUUID = alias;
      if (s.toUUID === oldUuid) s.toUUID = alias;
    }
  }
}
