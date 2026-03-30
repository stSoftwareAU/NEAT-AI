import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import type { TagInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { Approach } from "@neat/LogApproach.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { valuePenalty } from "@architecture/Score.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { LeakyReLU } from "@methods/activations/types/LeakyReLU.ts";
import { HYPOT } from "@deprecated/HYPOT.ts";
import { HYPOTv2 } from "@deprecated/HYPOTv2.ts";
import { MEAN } from "@deprecated/MEAN.ts";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import {
  cleanupOrphanedNeurons,
  pruneDeadSubgraphs,
  pruneZeroWeightSynapses,
} from "@compact/CompactUtils.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import { mergeParallelIdentityBridges } from "@compact/ParallelIdentityMerge.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

/**
 * Creates a shallow clone of a CreatureExport, copying neurons and synapses
 * as new objects to avoid mutation of the original.
 *
 * Issue #1015: This replaces the expensive JSON.parse(JSON.stringify())
 * pattern with direct property copy, which is significantly faster for
 * large networks (500KB+ with 619 neurons + 17,935 synapses).
 *
 * @param source - The CreatureExport to clone
 * @returns A new CreatureExport with independently copied neurons and synapses
 */
function cloneCreatureExport(source: CreatureExport): CreatureExport {
  // Clone neurons with shallow copy of each neuron object
  const neurons: NeuronExport[] = source.neurons.map((n) => {
    const cloned: NeuronExport = {
      type: n.type,
      bias: n.bias,
    };
    if (n.id !== undefined) (cloned as { id?: number }).id = n.id;
    if (n.uuid !== undefined) (cloned as { uuid?: string }).uuid = n.uuid;
    if (n.squash !== undefined) cloned.squash = n.squash;
    if (n.tags !== undefined) {
      cloned.tags = [...n.tags] as TagInterface[];
    }
    return cloned;
  });

  // Clone synapses with shallow copy of each synapse object
  const synapses: SynapseExport[] = source.synapses.map((s) => {
    const cloned: SynapseExport = {
      weight: s.weight,
    };
    if (s.fromId !== undefined) {
      (cloned as { fromId?: number }).fromId = s.fromId;
    }
    if (s.toId !== undefined) (cloned as { toId?: number }).toId = s.toId;
    if (s.fromUUID !== undefined) cloned.fromUUID = s.fromUUID;
    if (s.toUUID !== undefined) cloned.toUUID = s.toUUID;
    if (s.type !== undefined) cloned.type = s.type;
    if (s.tags !== undefined) {
      cloned.tags = [...s.tags] as TagInterface[];
    }
    return cloned;
  });

  // Build the cloned creature export
  const cloned: CreatureExport = {
    input: source.input,
    output: source.output,
    neurons,
    synapses,
  };

  // Copy optional top-level properties
  if (source.forwardOnly !== undefined) cloned.forwardOnly = source.forwardOnly;
  if (source.semanticVersion !== undefined) {
    cloned.semanticVersion = source.semanticVersion;
  }
  if (source.memetic !== undefined) {
    // Shallow copy of memetic - the nested structures are treated as immutable
    cloned.memetic = { ...source.memetic };
  }
  if (source.tags !== undefined) {
    cloned.tags = [...source.tags] as TagInterface[];
  }

  return cloned;
}

/**
 * Compacts a creature by removing redundant neurons and connections.
 *
 * @param creature - The creature to compact
 * @param feedbackLoop - Whether to use a feedback loop during compaction
 * @returns A new compacted creature or undefined if no compaction occurred
 */
export function compactCreature(
  creature: Creature,
  feedbackLoop: boolean,
): Creature | undefined {
  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  const startExport = creature.exportJSON();
  creature.DEBUG = holdDebug;
  // Public export omits integer ids; compaction logic expects fromId/toId on synapses.
  normaliseCreatureExport(startExport);

  // Issue #1015: Use direct property copy instead of JSON.parse(JSON.stringify())
  // for better performance with large networks.
  const compactCreature = cloneCreatureExport(startExport);

  // Pre-allocate neuronMap with expected size for better performance
  const neuronMap = new Map<number, NeuronExport>(
    compactCreature.neurons.map((neuron) => [neuron.id!, neuron]),
  );

  // Pre-allocate connection maps and build in a single pass
  const inwardConnections = new Map<number, SynapseExport[]>();
  const outwardConnections = new Map<number, SynapseExport[]>();

  for (const synapse of compactCreature.synapses) {
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

  let didCompact = false;

  // 29-Dec-2025: Safe algebraic bypass for COMPLEMENT neurons.
  //
  // When a COMPLEMENT neuron A (1 - x) has one or more outbound links to neuron(s) B,
  // and each B is not an aggregation squash (MAXIMUM/MINIMUM/IF/HYPOT), we can remove
  // A completely by folding its affine transform into each downstream neuron:
  //
  //   A = 1 - (Σ(wi * xi) + bA)
  //   contribution into B = wAB * A
  //                       = Σ((-wAB*wi) * xi) + wAB*(1 - bA)
  //
  // This is behaviour-preserving for summed pre-activation squashes (the default),
  // but it is NOT safe for aggregation squashes because they treat each inbound
  // value specially (eg MAXIMUM uses Math.max over inbound values).
  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;
    if (neuron.squash !== COMPLEMENT.NAME) continue;

    const indexByUUID = new Map<number, number>();
    for (let j = 0; j < compactCreature.neurons.length; j++) {
      indexByUUID.set(compactCreature.neurons[j].id!, j);
    }

    const inConns = inwardConnections.get(neuron.id!) || [];
    const outConns = outwardConnections.get(neuron.id!) || [];
    if (inConns.length === 0) continue;
    if (outConns.length === 0) continue;

    // Conservative: only bypass when *all* downstream neurons are non-aggregate.
    // (We could partially bypass some outbounds while keeping the neuron for
    // aggregate consumers, but that is more complex and not required here.)
    const toNeurons = outConns.map((c) => neuronMap.get(c.toId!));
    if (toNeurons.some((n) => !n)) continue;
    if (toNeurons.some((n) => isAggregationSquash(n!.squash))) continue;

    // Avoid introducing self-loops or invalid forward-only edges via bypass.
    let unsafe = false;
    for (const outConn of outConns) {
      if (outConn.toId === neuron.id!) {
        unsafe = true;
        break;
      }

      for (const inConn of inConns) {
        if (
          inConn.fromId === outConn.toId || inConn.fromId === neuron.id!
        ) {
          unsafe = true;
          break;
        }

        // If this creature is forward-only and feedbackLoop=false, avoid creating
        // any backward synapses during bypass.
        if (!feedbackLoop && creature.forwardOnly === true) {
          const fromIndex = indexByUUID.get(inConn.fromId!);
          const toIndex = indexByUUID.get(outConn.toId!);
          if (
            fromIndex !== undefined && toIndex !== undefined &&
            fromIndex > toIndex
          ) {
            unsafe = true;
            break;
          }
        }
      }

      if (unsafe) break;
    }
    if (unsafe) continue;

    for (const outConn of outConns) {
      const toNeuron = neuronMap.get(outConn.toId!)!;

      // Bias fold into downstream: bB += wAB*(1 - bA)
      toNeuron.bias += outConn.weight * (1 - neuron.bias);

      // Redirect each inbound connection directly into this downstream.
      for (const inConn of inConns) {
        const newWeight = (-outConn.weight) * inConn.weight;

        const existing = compactCreature.synapses.find((s) =>
          s.fromId === inConn.fromId! && s.toId === outConn.toId!
        );
        // Issue #1972: Preserve tags from both inbound and outbound synapses.
        const mergedTags = mergeTagsByNameValue(inConn.tags, outConn.tags);
        if (existing) {
          existing.weight += newWeight;
          if (mergedTags) {
            existing.tags = mergeTagsByNameValue(existing.tags, mergedTags);
          }
        } else {
          const newSynapse: SynapseExport = {
            fromId: inConn.fromId!,
            toId: outConn.toId!,
            weight: newWeight,
          };
          if (mergedTags) newSynapse.tags = mergedTags;
          compactCreature.synapses.push(newSynapse);
        }
      }
    }

    // Remove the COMPLEMENT neuron and all of its incident synapses.
    compactCreature.synapses = compactCreature.synapses.filter((s) =>
      s.fromId !== neuron.id! && s.toId !== neuron.id!
    );
    compactCreature.neurons = compactCreature.neurons.filter((n) =>
      n.id !== neuron.id!
    );
    neuronMap.delete(neuron.id!);

    // Rebuild inward/outward maps after changes.
    inwardConnections.clear();
    outwardConnections.clear();
    compactCreature.synapses.forEach((synapse) => {
      outwardConnections.set(
        synapse.fromId!,
        (outwardConnections.get(synapse.fromId!) || []).concat(synapse),
      );
      inwardConnections.set(
        synapse.toId!,
        (inwardConnections.get(synapse.toId!) || []).concat(synapse),
      );
    });

    assertValidSynapseReferences(
      compactCreature,
      "after COMPLEMENT bypass neuron removal",
    );

    didCompact = true;
    break; // One safe bypass per compaction call.
  }

  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;

    const inConns = inwardConnections.get(neuron.id!) || [];
    const outConns = outwardConnections.get(neuron.id!) || [];

    if (inConns.length === 1 && outConns.length === 1) {
      const [inConn] = inConns;
      const [outConn] = outConns;

      const fromNeuron = neuronMap.get(inConn.fromId!);
      const toNeuron = neuronMap.get(outConn.toId!);

      if (
        fromNeuron &&
        toNeuron &&
        neuron.squash === fromNeuron.squash &&
        (neuron.squash === IDENTITY.NAME ||
          neuron.squash === LOGISTIC.NAME) &&
        inConn.fromId !== neuron.id! &&
        outConn.toId !== neuron.id!
      ) {
        const existingSynapse = compactCreature.synapses.find(
          (s) => s.fromId === fromNeuron.id! && s.toId === toNeuron.id!,
        );

        if (existingSynapse) continue; // Skip compaction if synapse already exists

        // Correct bias accumulation using neuron.bias multiplied by outgoing weight
        const combinedWeight = inConn.weight * outConn.weight;
        assert(Number.isFinite(combinedWeight), "combinedWeight not finite");

        const combinedBias = neuron.bias + inConn.weight * fromNeuron.bias;
        assert(Number.isFinite(combinedBias), "combinedBias not finite");

        // Update toNeuron bias correctly to reflect chain accumulation
        neuron.bias = combinedBias;

        // Remove old synapses
        compactCreature.synapses = compactCreature.synapses.filter(
          (s) => s !== inConn && s !== outConn,
        );

        // Issue #1972: Preserve tags from both merged synapses.
        const chainMergedTags = mergeTagsByNameValue(inConn.tags, outConn.tags);

        // Add new synapse directly connecting fromNeuron to toNeuron
        const chainSynapse: SynapseExport = {
          weight: combinedWeight,
          fromId: fromNeuron.id!,
          toId: toNeuron.id!,
        };
        if (chainMergedTags) chainSynapse.tags = chainMergedTags;
        compactCreature.synapses.push(chainSynapse);

        // Remove neuron from neurons list
        compactCreature.neurons = compactCreature.neurons.filter((n) =>
          n.id !== neuron.id!
        );
        neuronMap.delete(neuron.id!);

        // Rebuild inward and outward maps after changes
        inwardConnections.clear();
        outwardConnections.clear();
        compactCreature.synapses.forEach((synapse) => {
          outwardConnections.set(
            synapse.fromId!,
            (outwardConnections.get(synapse.fromId!) || []).concat(synapse),
          );
          inwardConnections.set(
            synapse.toId!,
            (inwardConnections.get(synapse.toId!) || []).concat(synapse),
          );
        });

        assertValidSynapseReferences(
          compactCreature,
          "after chain compaction neuron removal",
        );

        didCompact = true;
        break; // restart the loop after each mutation
      }
    }
  }

  // Issue #1947: Merge parallel IDENTITY bridge neurons that all connect
  // to the same target into a single IDENTITY neuron with merged weights.
  const parallelResult = mergeParallelIdentityBridges(compactCreature);
  if (parallelResult.removedNeurons > 0) {
    didCompact = true;
  }

  // Issue #1948: Extend parallel merging to other compatible squash functions.
  // Currently supports COMPLEMENT (converted to IDENTITY before merging).
  // See SquashUtils.isParallelMergeableSquash() for the full analysis.
  const extendedParallelResult = mergeParallelBridges(compactCreature);
  if (extendedParallelResult.removedNeurons > 0) {
    didCompact = true;
  }

  /** If not feedback loop, remove synapses that are going backwards */
  if (!feedbackLoop) {
    // Create a map of neuron UUIDs to their indices for quick lookup
    const neuronIndexMap = new Map<number, number>();
    compactCreature.neurons.forEach((neuron, index) => {
      neuronIndexMap.set(neuron.id!, index);
    });

    // Create a set of synapses to remove
    const synapsesToRemove = new Set<SynapseExport>();

    // Check each synapse
    compactCreature.synapses.forEach((synapse) => {
      const fromIndex = neuronIndexMap.get(synapse.fromId!);
      const toIndex = neuronIndexMap.get(synapse.toId!);

      // If the source neuron appears later in the array than the target neuron
      if (
        fromIndex !== undefined && toIndex !== undefined &&
        fromIndex > toIndex
      ) {
        synapsesToRemove.add(synapse);
      }
    });

    // Remove the identified synapses
    compactCreature.synapses = compactCreature.synapses.filter(
      (synapse) => !synapsesToRemove.has(synapse),
    );
    if (synapsesToRemove.size > 0) {
      assertValidSynapseReferences(
        compactCreature,
        "after backward synapse removal",
      );
      didCompact = true;
    }
  }

  // 30-Dec-2025: Simplify large weights for homogeneous squashes (issue #642).
  //
  // For ABSOLUTE and IDENTITY we can rescale a neuron's inbound weights/bias by 1/c and
  // its outbound weights by c, without changing behaviour:
  //
  //   z  = Σ(wi*xi) + b
  //   z' = z / c
  //   f(z') = f(z) / c         (for ABSOLUTE and IDENTITY, with c > 0)
  //   (v*c) * (f(z)/c) = v*f(z)
  //
  // This can turn a "huge inbound / tiny outbound" pair into two moderate values,
  // reducing the score penalty (which is based on max/avg abs weights and biases).
  const simplifiedLargeWeights = simplifyLargeWeights(compactCreature);
  if (simplifiedLargeWeights) {
    didCompact = true;
  }

  // 29-Dec-2025: Behaviour-preserving pruning of zero-weight synapses.
  // See https://github.com/stSoftwareAU/NEAT-AI/issues/977
  const zeroResult = pruneZeroWeightSynapses(compactCreature);
  if (zeroResult.removedSynapses > 0) {
    didCompact = true;
  }

  /**
   * Clean up orphaned neurons using the robust iterative utility.
   *
   * This replaces a previous buggy loop that failed to:
   * - Set `danglesFound = true` when removing neurons (so iteration never continued)
   * - Rebuild the outwardConnections map after backward-synapse removal
   *
   * See https://github.com/stSoftwareAU/NEAT-AI/issues/956
   */
  const orphanResult = cleanupOrphanedNeurons(compactCreature);
  if (orphanResult.removed > 0 || orphanResult.converted > 0) {
    didCompact = true;
  }

  // Prune dead subgraphs (neurons/synapses that cannot influence any output).
  const deadResult = pruneDeadSubgraphs(compactCreature);
  if (deadResult.removedNeurons > 0 || deadResult.removedSynapses > 0) {
    didCompact = true;
  }

  if (didCompact) {
    addTag(compactCreature, "approach", "compact" as Approach);
    delete compactCreature.memetic;
    removeTag(compactCreature, "approach-logged");

    /** CreatureExport.neurons excludes inputs as the export does not include them.*/
    const oldNeurons = startExport.neurons.length - startExport.output;
    addTag(compactCreature, "old-neurons", oldNeurons.toString());

    // Preserve forwardOnly semantics from source creature
    if (creature.forwardOnly === true) {
      compactCreature.forwardOnly = true;
    }

    assertValidSynapseReferences(
      compactCreature,
      "before Creature.fromJSON in compactCreature",
    );

    const c = Creature.fromJSON(compactCreature);

    return c;
  }

  return undefined;
}

function simplifyLargeWeights(exported: CreatureExport): boolean {
  // Supported squashes are those that are scale-homogeneous in our implementation:
  //
  // For any k > 0: f(kx) = k f(x)
  //
  // This includes both "linear" squashes (ActivationInterface) and some
  // aggregation squashes (NeuronActivationInterface) that remain homogeneous.
  const candidateSquashes = new Set<string>([
    ABSOLUTE.NAME,
    IDENTITY.NAME,
    ReLU.NAME,
    LeakyReLU.NAME,
    MAXIMUM.NAME,
    MINIMUM.NAME,
    IF.NAME,
    HYPOT.NAME,
    HYPOTv2.NAME,
    MEAN.NAME,
  ]);

  // Only attempt rescaling when there is a meaningful imbalance (3+ orders of magnitude).
  // The accept/reject gate below uses the same penalty logic as scoring, so this heuristic
  // is purely a performance guard.
  const IMBALANCE_RATIO = 1_000;

  const inward = new Map<number, SynapseExport[]>();
  const outward = new Map<number, SynapseExport[]>();
  for (const s of exported.synapses) {
    outward.set(s.fromId!, (outward.get(s.fromId!) ?? []).concat(s));
    inward.set(s.toId!, (inward.get(s.toId!) ?? []).concat(s));
  }

  let changed = false;
  let bestPenalty = calculateWeightBiasPenalty(exported);

  for (const neuron of exported.neurons) {
    if (neuron.type !== "hidden") continue;
    if (!neuron.squash || !candidateSquashes.has(neuron.squash)) continue;

    const inConns = inward.get(neuron.id!) ?? [];
    const outConns = outward.get(neuron.id!) ?? [];
    if (inConns.length === 0) continue;
    if (outConns.length === 0) continue;

    let maxIn = Math.abs(neuron.bias);
    for (const s of inConns) maxIn = Math.max(maxIn, Math.abs(s.weight));

    let maxOut = 0;
    for (const s of outConns) maxOut = Math.max(maxOut, Math.abs(s.weight));

    if (maxIn === 0 || maxOut === 0) continue;

    const ratio = maxIn / maxOut;
    if (ratio < 1 / IMBALANCE_RATIO || ratio > IMBALANCE_RATIO) {
      // Choose c to equalise maxIn/c and maxOut*c, minimising their maximum.
      const c = Math.sqrt(maxIn / maxOut);
      if (!Number.isFinite(c) || c === 0 || c === 1) continue;

      // Snapshot for revert.
      const oldBias = neuron.bias;
      const oldInWeights = inConns.map((s) => s.weight);
      const oldOutWeights = outConns.map((s) => s.weight);

      neuron.bias = neuron.bias / c;
      for (const s of inConns) s.weight = s.weight / c;
      for (const s of outConns) s.weight = s.weight * c;

      // Reject if we introduced anything non-finite.
      const allFinite = Number.isFinite(neuron.bias) &&
        inConns.every((s) => Number.isFinite(s.weight)) &&
        outConns.every((s) => Number.isFinite(s.weight));

      if (!allFinite) {
        neuron.bias = oldBias;
        inConns.forEach((s, i) => s.weight = oldInWeights[i]);
        outConns.forEach((s, i) => s.weight = oldOutWeights[i]);
        continue;
      }

      const nextPenalty = calculateWeightBiasPenalty(exported);
      if (nextPenalty + 1e-15 < bestPenalty) {
        bestPenalty = nextPenalty;
        changed = true;
      } else {
        // No improvement; revert.
        neuron.bias = oldBias;
        inConns.forEach((s, i) => s.weight = oldInWeights[i]);
        outConns.forEach((s, i) => s.weight = oldOutWeights[i]);
      }
    }
  }

  if (changed) {
    // Memetic values were tuned for the previous scale; treat them as stale.
    delete exported.memetic;
  }

  return changed;
}

function calculateWeightBiasPenalty(exported: CreatureExport): number {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const synapse of exported.synapses) {
    const w = Math.abs(synapse.weight);
    if (!Number.isFinite(w)) continue;
    max = Math.max(max, w);
    total += w;
    count++;
  }

  // CreatureExport.neurons excludes inputs; bias is defined for all entries here.
  for (const neuron of exported.neurons) {
    const b = Math.abs(neuron.bias);
    if (!Number.isFinite(b)) continue;
    max = Math.max(max, b);
    total += b;
    count++;
  }

  // No weights/biases should never happen for a valid creature, but keep it safe.
  if (count === 0) return 0;

  // Mirror Score.calculateMaxOutOfBounds() safety: clamp to avoid tripping
  // `valuePenalty()` asserts on absurd magnitudes.
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;

  const avg = total / count;
  return (valuePenalty(max) + valuePenalty(avg)) / 2;
}
