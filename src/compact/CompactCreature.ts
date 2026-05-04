import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { Approach } from "@neat/LogApproach.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";
import {
  cleanupOrphanedNeurons,
  cloneCreatureExport,
  pruneDeadSubgraphs,
  pruneZeroWeightSynapses,
} from "@compact/CompactUtils.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import { mergeParallelIdentityBridges } from "@compact/ParallelIdentityMerge.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { simplifyLargeWeights } from "@compact/SimplifyLargeWeights.ts";
import { removeBackwardSynapses } from "@compact/RemoveBackwardSynapses.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";

/**
 * Compacts a creature by removing redundant neurons and connections.
 *
 * @param creature - The creature to compact
 * @param feedbackLoop - Whether to use a feedback loop during compaction
 * @param mcmcTemperature - Issue #2200: Optional MCMC temperature for probabilistic
 *   weight rescaling acceptance. When provided, worsening rescalings may be accepted
 *   with probability exp(-delta / temperature) instead of greedy rejection.
 * @returns A new compacted creature or undefined if no compaction occurred
 */
export function compactCreature(
  creature: Creature,
  feedbackLoop: boolean,
  mcmcTemperature?: number,
): Creature | undefined {
  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  // Issue #2511: compaction may receive a forward-only creature with
  // intentional backward synapses (Issue #956 test fixtures, GRQ-12
  // post-strip recovery). Use the unchecked export so the save-side
  // assertion does not fire here — this is an internal clone, not a save.
  const startExport = exportJSONUnchecked(creature);
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
    const backwardResult = removeBackwardSynapses(compactCreature);
    if (backwardResult.removedSynapses > 0) {
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
  const simplifiedLargeWeights = simplifyLargeWeights(
    compactCreature,
    mcmcTemperature,
  );
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
