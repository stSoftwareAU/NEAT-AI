import { assert } from "@std/assert";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import {
  isAggregationSquash,
  isParallelMergeableSquash,
} from "@methods/activations/SquashUtils.ts";
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
 * **Ordering (Issue #3809).** The merge rewires every group member's inbound
 * synapse onto the kept neuron, so the kept neuron must sit *after* all of
 * those sources in the export's neuron order — that order is the activation
 * order `loadFrom` rebuilds. Only bridges whose own edges already run forward
 * are merged, and the kept neuron is the one latest in that order; anything
 * else would turn a forward edge into a recurrent one (stripped at load on a
 * forward-only creature, silently changing the outputs).
 *
 * **The target must sum the merged synapses (Issue #3809).** Collapsing a
 * group into one synapse is only lossless where the target adds the
 * contributions up. MAXIMUM, MINIMUM and HYPOT targets are declined outright;
 * an IF target is merged only per synapse type (`positive` / `negative`,
 * never `condition`), because it reads those as three separate sums and
 * compares the condition sum against zero.
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

  // Activation order (Issue #3809): `loadFrom` lays inputs out at 0..input-1
  // and then appends every non-input export neuron in array order, so a
  // synapse runs forward exactly when its source's position is lower than its
  // target's. The merge must preserve that, hence positions are needed here.
  const positionById = new Map<number, number>();
  for (let i = 0; i < exported.input; i++) {
    positionById.set(i, i);
  }
  // A CreatureExport never carries input neurons, so the exported array picks
  // up exactly where the inputs left off.
  const neuronById = new Map<number, NeuronExport>();
  let position = exported.input;
  for (const neuron of exported.neurons) {
    positionById.set(neuron.id!, position++);
    neuronById.set(neuron.id!, neuron);
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

      // Both of the bridge's own edges must already run forward — a backward
      // edge carries the previous activation's value, and merging it into a
      // forward group would silently re-time the network.
      const bridgePosition = positionById.get(neuron.id!);
      const sourcePosition = positionById.get(inConns[0].fromId!);
      const targetPosition = positionById.get(outConns[0].toId!);
      if (
        bridgePosition === undefined || sourcePosition === undefined ||
        targetPosition === undefined
      ) {
        continue;
      }
      if (sourcePosition >= bridgePosition) continue;
      if (bridgePosition >= targetPosition) continue;

      // The target must combine the merged contributions by a plain weighted
      // sum, otherwise folding them into one synapse changes its value
      // (Issue #3809). IF is the one aggregation squash that qualifies: it
      // sums its condition, positive and negative synapses separately, so a
      // group sharing one synapse type is still exact. MAXIMUM, MINIMUM and
      // HYPOT combine their inputs non-additively — decline those.
      const target = neuronById.get(outConns[0].toId!);
      if (!target) continue;
      if (isAggregationSquash(target.squash)) {
        if (target.squash !== "IF") continue;
        // An IF's condition synapses are summed and then compared against
        // zero. Re-associating that sum is exact in real arithmetic but not
        // in float32, and a sum sitting near the boundary would flip the
        // branch — a large output change from a rounding difference. Merge
        // only the value-carrying synapses.
        if (outConns[0].type === "condition") continue;
      }

      bridgeNeurons.push(neuron);
    }
  }

  if (bridgeNeurons.length < 2) {
    return { removedNeurons: 0 };
  }

  // Group bridge neurons by (outbound target, squash function, outbound
  // synapse type). Only neurons with the same squash can be merged together,
  // and only synapses the target treats alike: an IF neuron reads its
  // `condition`, `positive` and `negative` synapses as three separate sums,
  // so folding two of them into one would move a term between those sums
  // (Issue #3809).
  const groupKey = (neuron: NeuronExport): string => {
    const outConns = outwardConnections.get(neuron.id!)!;
    return `${outConns[0].toId!}::${neuron.squash}::${outConns[0].type ?? ""}`;
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

    // Keep the neuron latest in activation order, merge the others into it.
    // Every member's source precedes its own bridge, which in turn is at or
    // before the kept neuron, so all redirected synapses stay forward
    // (Issue #3809). Keeping an earlier member would push the later members'
    // sources behind the merged neuron and emit recurrent synapses.
    let kept = group[0];
    for (const neuron of group) {
      if (positionById.get(neuron.id!)! > positionById.get(kept.id!)!) {
        kept = neuron;
      }
    }
    const keptInConn = (inwardConnections.get(kept.id!) ?? [])[0];
    const keptOutConn = (outwardConnections.get(kept.id!) ?? [])[0];
    const toRemove = group.filter((neuron) => neuron !== kept);

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

      // Redirect the inbound synapse to point at the kept neuron. Guarded
      // rather than assumed: a redirected synapse that ran backwards would be
      // stripped at load and silently change the creature's outputs (#3809).
      assert(
        positionById.get(removedInConn.fromId!)! < positionById.get(kept.id!)!,
        "Redirected synapse must stay forward",
      );
      removedInConn.toId = kept.id!;
      // UUIDs are the canonical wire identity `loadFrom` resolves first, so
      // the redirect has to move both handles — leaving a stale `toUUID`
      // behind would only work while the removed neuron's UUID is absent.
      if (kept.uuid !== undefined) {
        removedInConn.toUUID = kept.uuid;
      } else {
        delete removedInConn.toUUID;
      }
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
