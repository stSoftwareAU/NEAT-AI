import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { COMPLEMENT } from "../methods/activations/types/COMPLEMENT.ts";
import { IF } from "../methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "../methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "../methods/activations/aggregate/MINIMUM.ts";
import { HYPOT } from "../deprecated/HYPOT.ts";
import { HYPOTv2 } from "../deprecated/HYPOTv2.ts";
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
