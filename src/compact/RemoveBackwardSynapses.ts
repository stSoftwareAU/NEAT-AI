import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";

/**
 * Result of the backward-synapse removal pass.
 */
export interface RemoveBackwardSynapsesResult {
  /** Number of synapses removed because they pointed backwards. */
  removedSynapses: number;
}

/**
 * Removes synapses whose source neuron appears later in the neuron array
 * than their target neuron — i.e. synapses that would create a recurrent
 * connection in a forward-only topology.
 *
 * This pass is only meaningful when the surrounding pipeline is operating in
 * feed-forward mode; callers that need a recurrent-friendly compaction
 * should skip the call entirely.
 *
 * Runs a synapse-reference integrity check after mutation when anything was
 * removed, matching the behaviour of the original inline block inside
 * `compactCreature`.
 *
 * @param exported - The creature export to mutate in place.
 * @returns The number of synapses that were removed.
 */
export function removeBackwardSynapses(
  exported: CreatureExport,
): RemoveBackwardSynapsesResult {
  // Map neuron integer id → array index for quick lookup.
  const neuronIndexMap = new Map<number, number>();
  exported.neurons.forEach((neuron, index) => {
    neuronIndexMap.set(neuron.id!, index);
  });

  // Set of synapses to remove (identity-based so filter is cheap).
  const synapsesToRemove = new Set<SynapseExport>();

  for (const synapse of exported.synapses) {
    const fromIndex = neuronIndexMap.get(synapse.fromId!);
    const toIndex = neuronIndexMap.get(synapse.toId!);

    // If the source neuron appears later in the array than the target neuron
    // the synapse is pointing backwards.
    if (
      fromIndex !== undefined && toIndex !== undefined &&
      fromIndex > toIndex
    ) {
      synapsesToRemove.add(synapse);
    }
  }

  if (synapsesToRemove.size === 0) {
    return { removedSynapses: 0 };
  }

  exported.synapses = exported.synapses.filter(
    (synapse) => !synapsesToRemove.has(synapse),
  );

  assertValidSynapseReferences(
    exported,
    "after backward synapse removal",
  );

  return { removedSynapses: synapsesToRemove.size };
}
