import { assert } from "@std/assert";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { isParallelMergeableSquash } from "@methods/activations/SquashUtils.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";

/**
 * Result of the parallel bridge neuron merge pass.
 */
export interface ParallelBridgeMergeResult {
  /** Number of neurons that were removed by merging. */
  removedNeurons: number;
}

/**
 * Detects and merges groups of parallel bridge neurons that all connect to
 * the same target neuron, for squash functions where this is mathematically
 * safe (issue #1948).
 *
 * A "bridge neuron" is a hidden neuron with exactly 1 inbound and 1 outbound
 * synapse. When multiple such neurons with the **same** mergeable squash
 * function all feed the same target, they can be collapsed into a single
 * IDENTITY neuron with merged weights and bias — reducing neuron count
 * without changing behaviour.
 *
 * Supported squash functions and their conversion to IDENTITY:
 *
 * **IDENTITY** (f(x) = x):
 *   Already linear. No conversion needed.
 *   w_merged_i = w_out_i * w_in_i
 *   bias_merged = Σ(w_out_i * bias_i)
 *
 * **COMPLEMENT** (f(x) = 1 - x):
 *   Affine, convertible to IDENTITY:
 *     1 - (w*x + b) = (-w)*x + (1 - b)
 *   So: w_in' = -w_in, bias' = 1 - bias
 *   Then standard IDENTITY merging applies:
 *     w_merged_i = w_out_i * w_in'_i = w_out_i * (-w_in_i)
 *     bias_merged = Σ(w_out_i * bias'_i) = Σ(w_out_i * (1 - bias_i))
 *
 * @param exported - The creature export to modify in-place
 * @returns The number of neurons removed
 */
export function mergeParallelBridges(
  exported: CreatureExport,
): ParallelBridgeMergeResult {
  // Ensure runtime integer id/fromId/toId fields are populated from UUIDs.
  normaliseCreatureExport(exported);

  // Build connection maps.
  const inwardConnections = new Map<number, SynapseExport[]>();
  const outwardConnections = new Map<number, SynapseExport[]>();

  for (const synapse of exported.synapses) {
    const outList = outwardConnections.get(synapse.fromId!);
    if (outList) {
      outList.push(synapse);
    } else {
      outwardConnections.set(synapse.fromId!, [synapse]);
    }

    const inList = inwardConnections.get(synapse.toId!);
    if (inList) {
      inList.push(synapse);
    } else {
      inwardConnections.set(synapse.toId!, [synapse]);
    }
  }

  // Identify mergeable bridge neurons: hidden, mergeable squash, exactly 1 in + 1 out.
  const bridgeNeurons: NeuronExport[] = [];
  for (const neuron of exported.neurons) {
    if (neuron.type !== "hidden") continue;
    if (!isParallelMergeableSquash(neuron.squash)) continue;

    const inConns = inwardConnections.get(neuron.id!) ?? [];
    const outConns = outwardConnections.get(neuron.id!) ?? [];

    if (inConns.length === 1 && outConns.length === 1) {
      // Ensure no self-loops.
      if (inConns[0].fromId === neuron.id!) continue;
      if (outConns[0].toId === neuron.id!) continue;
      bridgeNeurons.push(neuron);
    }
  }

  if (bridgeNeurons.length < 2) {
    return { removedNeurons: 0 };
  }

  // Group bridge neurons by (outbound target UUID, squash function).
  // Only neurons with the same squash can be merged together.
  const groupKey = (neuron: NeuronExport): string => {
    const outConns = outwardConnections.get(neuron.id!)!;
    return `${outConns[0].toId!}::${neuron.squash}`;
  };

  const groupsByKey = new Map<string, NeuronExport[]>();
  for (const neuron of bridgeNeurons) {
    const key = groupKey(neuron);
    const group = groupsByKey.get(key);
    if (group) {
      group.push(neuron);
    } else {
      groupsByKey.set(key, [neuron]);
    }
  }

  let totalRemoved = 0;

  for (const [_key, group] of groupsByKey) {
    if (group.length < 2) continue;

    // Check for duplicate inbound sources — if two bridge neurons share the
    // same input source, merging would create duplicate synapses to the kept
    // neuron. Skip such groups.
    const inboundSources = new Set<number>();
    let hasDuplicateSource = false;
    for (const neuron of group) {
      const inConn = (inwardConnections.get(neuron.id!) ?? [])[0];
      if (inboundSources.has(inConn.fromId!)) {
        hasDuplicateSource = true;
        break;
      }
      inboundSources.add(inConn.fromId!);
    }
    if (hasDuplicateSource) continue;

    // Convert non-IDENTITY neurons to IDENTITY equivalent before merging.
    // This modifies the neuron and synapse in-place.
    for (const neuron of group) {
      convertToIdentity(neuron, inwardConnections);
    }

    // Keep the first neuron, merge others into it.
    const kept = group[0];
    const keptInConn = (inwardConnections.get(kept.id!) ?? [])[0];
    const keptOutConn = (outwardConnections.get(kept.id!) ?? [])[0];
    const toRemove = group.slice(1);

    // Calculate merged bias and adjust the kept neuron's outbound weight to 1.
    const keptOutWeight = keptOutConn.weight;

    // Compute merged bias contribution from all neurons in the group.
    let mergedBias = keptOutWeight * kept.bias;
    for (const removed of toRemove) {
      const removedOutConn = (outwardConnections.get(removed.id!) ?? [])[0];
      mergedBias += removedOutConn.weight * removed.bias;
    }

    // Adjust kept neuron: set its outbound weight to 1, adjust its inbound
    // weight to absorb the original outbound weight.
    const newKeptInWeight = keptOutWeight * keptInConn.weight;
    assert(
      Number.isFinite(newKeptInWeight),
      "Merged inbound weight must be finite",
    );
    keptInConn.weight = newKeptInWeight;
    keptOutConn.weight = 1;
    kept.bias = mergedBias;
    assert(Number.isFinite(kept.bias), "Merged bias must be finite");

    // Redirect inbound synapses from removed neurons to the kept neuron,
    // with adjusted weights.
    const idsToRemove = new Set<number>();
    for (const removed of toRemove) {
      const removedInConn = (inwardConnections.get(removed.id!) ?? [])[0];
      const removedOutConn = (outwardConnections.get(removed.id!) ?? [])[0];

      // New weight for the redirected synapse: w_out_removed * w_in_removed
      const newWeight = removedOutConn.weight * removedInConn.weight;
      assert(
        Number.isFinite(newWeight),
        "Redirected synapse weight not finite",
      );

      // Redirect the inbound synapse to point at the kept neuron.
      removedInConn.toId = kept.id!;
      removedInConn.weight = newWeight;

      // Issue #1972: Merge neuron tags from removed neurons onto kept neuron.
      const mergedNeuronTags = mergeTagsByNameValue(kept.tags, removed.tags);
      if (mergedNeuronTags) {
        kept.tags = mergedNeuronTags;
      }

      idsToRemove.add(removed.id!);
    }

    // Remove outbound synapses of the removed neurons.
    exported.synapses = exported.synapses.filter((s) => {
      if (idsToRemove.has(s.fromId!)) return false;
      return true;
    });

    // Remove the merged neurons.
    exported.neurons = exported.neurons.filter(
      (n) => !idsToRemove.has(n.id!),
    );

    totalRemoved += toRemove.length;

    assertValidSynapseReferences(
      exported,
      "after parallel bridge merge",
    );

    // Only merge one group per pass (consistent with other compact passes).
    break;
  }

  return { removedNeurons: totalRemoved };
}

/**
 * Converts a bridge neuron's squash function to IDENTITY in-place.
 *
 * For IDENTITY neurons, this is a no-op.
 * For COMPLEMENT neurons: 1 - (w*x + b) = (-w)*x + (1 - b).
 *
 * @param neuron - The neuron to convert (modified in-place)
 * @param inwardConnections - Map of neuron UUID → inbound synapses
 */
function convertToIdentity(
  neuron: NeuronExport,
  inwardConnections: Map<number, SynapseExport[]>,
): void {
  if (neuron.squash === "IDENTITY") return;

  if (neuron.squash === "COMPLEMENT") {
    // COMPLEMENT: f(x) = 1 - x
    // 1 - (w*x + b) = (-w)*x + (1 - b)
    const inConns = inwardConnections.get(neuron.id!) ?? [];
    for (const conn of inConns) {
      conn.weight = -conn.weight;
    }
    neuron.bias = 1 - neuron.bias;
    neuron.squash = "IDENTITY";
    return;
  }

  // This should not be reached if isParallelMergeableSquash is correct.
  throw new Error(
    `Cannot convert squash "${neuron.squash}" to IDENTITY for parallel merging`,
  );
}
