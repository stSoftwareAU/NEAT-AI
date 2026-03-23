import { assert } from "@std/assert";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";

/**
 * Result of the parallel IDENTITY bridge neuron merge pass.
 */
export interface ParallelIdentityMergeResult {
  /** Number of IDENTITY neurons that were removed by merging. */
  removedNeurons: number;
}

/**
 * Detects and merges groups of parallel IDENTITY bridge neurons that all
 * connect to the same target neuron.
 *
 * A "bridge neuron" is a hidden IDENTITY neuron with exactly 1 inbound and
 * 1 outbound synapse. When multiple such neurons all feed the same target,
 * they can be collapsed into a single IDENTITY neuron with merged weights
 * and bias — reducing neuron count without changing behaviour.
 *
 * Mathematical equivalence (issue #1947):
 *
 * Before merge, the target receives from the group:
 *   Σ_i [ w_out_i * (w_in_i * x_i + bias_i) ]
 *
 * After merge into a single IDENTITY neuron H with w_out = 1:
 *   Σ_i [ w_merged_i * x_i ] + bias_merged
 *
 * where w_merged_i = w_out_i * w_in_i and bias_merged = Σ_i (w_out_i * bias_i).
 *
 * @param exported - The creature export to modify in-place
 * @returns The number of neurons removed
 */
export function mergeParallelIdentityBridges(
  exported: CreatureExport,
): ParallelIdentityMergeResult {
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

  // Build neuron index map for forward-only checks.
  const neuronIndexMap = new Map<number, number>();
  for (let i = 0; i < exported.neurons.length; i++) {
    neuronIndexMap.set(exported.neurons[i].id!, i);
  }

  // Identify IDENTITY bridge neurons: hidden, IDENTITY squash, exactly 1 in + 1 out.
  const bridgeNeurons: NeuronExport[] = [];
  for (const neuron of exported.neurons) {
    if (neuron.type !== "hidden") continue;
    if (neuron.squash !== "IDENTITY") continue;

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

  // Group bridge neurons by their outbound target UUID.
  const groupsByTarget = new Map<number, NeuronExport[]>();
  for (const neuron of bridgeNeurons) {
    const outConns = outwardConnections.get(neuron.id!)!;
    const targetId = outConns[0].toId!;
    const group = groupsByTarget.get(targetId);
    if (group) {
      group.push(neuron);
    } else {
      groupsByTarget.set(targetId, [neuron]);
    }
  }

  let totalRemoved = 0;

  for (const [_targetId, group] of groupsByTarget) {
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

    // Keep the first neuron, merge others into it.
    const kept = group[0];
    const keptInConn = (inwardConnections.get(kept.id!) ?? [])[0];
    const keptOutConn = (outwardConnections.get(kept.id!) ?? [])[0];
    const toRemove = group.slice(1);

    // Calculate merged bias and adjust the kept neuron's outbound weight to 1.
    // Using w_out = 1 simplification from the issue's mathematical proof.
    //
    // For the kept neuron: new inbound weight = w_out_kept * w_in_kept
    // For removed neurons: redirect their inbound synapse to the kept neuron
    //   with weight = w_out_removed * w_in_removed
    // bias_merged = Σ_i (w_out_i * bias_i) for all neurons in the group.

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

    // Only merge one group per pass (consistent with other compact passes).
    break;
  }

  return { removedNeurons: totalRemoved };
}
