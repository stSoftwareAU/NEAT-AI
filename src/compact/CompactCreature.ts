import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { valuePenalty } from "../architecture/Score.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { COMPLEMENT } from "../methods/activations/types/COMPLEMENT.ts";
import { ABSOLUTE } from "../methods/activations/types/ABSOLUTE.ts";
import { ReLU } from "../methods/activations/types/ReLU.ts";
import { LeakyReLU } from "../methods/activations/types/LeakyReLU.ts";
import { IF } from "../methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "../methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "../methods/activations/aggregate/MINIMUM.ts";
import { HYPOT } from "../deprecated/HYPOT.ts";
import { HYPOTv2 } from "../deprecated/HYPOTv2.ts";
import { MEAN } from "../deprecated/MEAN.ts";
import {
  cleanupOrphanedNeurons,
  pruneDeadSubgraphs,
  pruneZeroWeightSynapses,
} from "./CompactUtils.ts";

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

  const compactCreature = JSON.parse(
    JSON.stringify(startExport),
  ) as CreatureExport;

  const neuronMap = new Map<string, NeuronExport>();
  compactCreature.neurons.forEach((neuron) =>
    neuronMap.set(neuron.uuid, neuron)
  );

  const inwardConnections = new Map<string, SynapseExport[]>();
  const outwardConnections = new Map<string, SynapseExport[]>();

  compactCreature.synapses.forEach((synapse) => {
    outwardConnections.set(
      synapse.fromUUID,
      (outwardConnections.get(synapse.fromUUID) || []).concat(synapse),
    );
    inwardConnections.set(
      synapse.toUUID,
      (inwardConnections.get(synapse.toUUID) || []).concat(synapse),
    );
  });

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
  for (let i = 0; i < compactCreature.neurons.length; i++) {
    const neuron = compactCreature.neurons[i];
    if (neuron.type !== "hidden") continue;
    if (neuron.squash !== COMPLEMENT.NAME) continue;

    const indexByUUID = new Map<string, number>();
    for (let j = 0; j < compactCreature.neurons.length; j++) {
      indexByUUID.set(compactCreature.neurons[j].uuid, j);
    }

    const inConns = inwardConnections.get(neuron.uuid) || [];
    const outConns = outwardConnections.get(neuron.uuid) || [];
    if (inConns.length === 0) continue;
    if (outConns.length === 0) continue;

    // Conservative: only bypass when *all* downstream neurons are non-aggregate.
    // (We could partially bypass some outbounds while keeping the neuron for
    // aggregate consumers, but that is more complex and not required here.)
    const toNeurons = outConns.map((c) => neuronMap.get(c.toUUID));
    if (toNeurons.some((n) => !n)) continue;
    if (toNeurons.some((n) => isAggregationSquashName(n!.squash))) continue;

    // Avoid introducing self-loops or invalid forward-only edges via bypass.
    let unsafe = false;
    for (const outConn of outConns) {
      if (outConn.toUUID === neuron.uuid) {
        unsafe = true;
        break;
      }

      for (const inConn of inConns) {
        if (
          inConn.fromUUID === outConn.toUUID || inConn.fromUUID === neuron.uuid
        ) {
          unsafe = true;
          break;
        }

        // If this creature is forward-only and feedbackLoop=false, avoid creating
        // any backward synapses during bypass.
        if (!feedbackLoop && creature.forwardOnly === true) {
          const fromIndex = indexByUUID.get(inConn.fromUUID);
          const toIndex = indexByUUID.get(outConn.toUUID);
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
      const toNeuron = neuronMap.get(outConn.toUUID)!;

      // Bias fold into downstream: bB += wAB*(1 - bA)
      toNeuron.bias += outConn.weight * (1 - neuron.bias);

      // Redirect each inbound connection directly into this downstream.
      for (const inConn of inConns) {
        const newWeight = (-outConn.weight) * inConn.weight;

        const existing = compactCreature.synapses.find((s) =>
          s.fromUUID === inConn.fromUUID && s.toUUID === outConn.toUUID
        );
        if (existing) {
          existing.weight += newWeight;
        } else {
          compactCreature.synapses.push({
            fromUUID: inConn.fromUUID,
            toUUID: outConn.toUUID,
            weight: newWeight,
          });
        }
      }
    }

    // Remove the COMPLEMENT neuron and all of its incident synapses.
    compactCreature.synapses = compactCreature.synapses.filter((s) =>
      s.fromUUID !== neuron.uuid && s.toUUID !== neuron.uuid
    );
    compactCreature.neurons = compactCreature.neurons.filter((n) =>
      n.uuid !== neuron.uuid
    );
    neuronMap.delete(neuron.uuid);

    // Rebuild inward/outward maps after changes.
    inwardConnections.clear();
    outwardConnections.clear();
    compactCreature.synapses.forEach((synapse) => {
      outwardConnections.set(
        synapse.fromUUID,
        (outwardConnections.get(synapse.fromUUID) || []).concat(synapse),
      );
      inwardConnections.set(
        synapse.toUUID,
        (inwardConnections.get(synapse.toUUID) || []).concat(synapse),
      );
    });

    didCompact = true;
    break; // One safe bypass per compaction call.
  }

  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;

    const inConns = inwardConnections.get(neuron.uuid) || [];
    const outConns = outwardConnections.get(neuron.uuid) || [];

    if (inConns.length === 1 && outConns.length === 1) {
      const [inConn] = inConns;
      const [outConn] = outConns;

      const fromNeuron = neuronMap.get(inConn.fromUUID);
      const toNeuron = neuronMap.get(outConn.toUUID);

      if (
        fromNeuron &&
        toNeuron &&
        neuron.squash === fromNeuron.squash &&
        (neuron.squash === IDENTITY.NAME ||
          neuron.squash === LOGISTIC.NAME) &&
        inConn.fromUUID !== neuron.uuid &&
        outConn.toUUID !== neuron.uuid
      ) {
        const existingSynapse = compactCreature.synapses.find(
          (s) => s.fromUUID === fromNeuron.uuid && s.toUUID === toNeuron.uuid,
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

        // Add new synapse directly connecting fromNeuron to toNeuron
        compactCreature.synapses.push({
          weight: combinedWeight,
          fromUUID: fromNeuron.uuid,
          toUUID: toNeuron.uuid,
        });

        // Remove neuron from neurons list
        compactCreature.neurons = compactCreature.neurons.filter((n) =>
          n.uuid !== neuron.uuid
        );
        neuronMap.delete(neuron.uuid);

        // Rebuild inward and outward maps after changes
        inwardConnections.clear();
        outwardConnections.clear();
        compactCreature.synapses.forEach((synapse) => {
          outwardConnections.set(
            synapse.fromUUID,
            (outwardConnections.get(synapse.fromUUID) || []).concat(synapse),
          );
          inwardConnections.set(
            synapse.toUUID,
            (inwardConnections.get(synapse.toUUID) || []).concat(synapse),
          );
        });

        didCompact = true;
        break; // restart the loop after each mutation
      }
    }
  }

  /** If not feedback loop, remove synapses that are going backwards */
  if (!feedbackLoop) {
    // Create a map of neuron UUIDs to their indices for quick lookup
    const neuronIndexMap = new Map<string, number>();
    compactCreature.neurons.forEach((neuron, index) => {
      neuronIndexMap.set(neuron.uuid, index);
    });

    // Create a set of synapses to remove
    const synapsesToRemove = new Set<SynapseExport>();

    // Check each synapse
    compactCreature.synapses.forEach((synapse) => {
      const fromIndex = neuronIndexMap.get(synapse.fromUUID);
      const toIndex = neuronIndexMap.get(synapse.toUUID);

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

    const oldNeurons = startExport.neurons.length -
      startExport.input - startExport.output;
    addTag(compactCreature, "old-neurons", oldNeurons.toString());

    // Preserve forwardOnly semantics from source creature
    if (creature.forwardOnly === true) {
      compactCreature.forwardOnly = true;
    }

    const c = Creature.fromJSON(compactCreature);

    // Validate the compacted creature to catch any structural issues early.
    // A 4.x forward-only creature must remain valid; any failure here is a bug.
    c.validate();
    if (!feedbackLoop && creature.forwardOnly === true) {
      c.validate({ forwardOnly: true });
    }

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

  const inward = new Map<string, SynapseExport[]>();
  const outward = new Map<string, SynapseExport[]>();
  for (const s of exported.synapses) {
    outward.set(s.fromUUID, (outward.get(s.fromUUID) ?? []).concat(s));
    inward.set(s.toUUID, (inward.get(s.toUUID) ?? []).concat(s));
  }

  let changed = false;
  let bestPenalty = calculateWeightBiasPenalty(exported);

  for (const neuron of exported.neurons) {
    if (neuron.type !== "hidden") continue;
    if (!neuron.squash || !candidateSquashes.has(neuron.squash)) continue;

    const inConns = inward.get(neuron.uuid) ?? [];
    const outConns = outward.get(neuron.uuid) ?? [];
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

function isAggregationSquashName(name?: string): boolean {
  switch (name) {
    case MAXIMUM.NAME:
    case MINIMUM.NAME:
    case IF.NAME:
    case HYPOT.NAME:
    case HYPOTv2.NAME:
      return true;
    default:
      return false;
  }
}
