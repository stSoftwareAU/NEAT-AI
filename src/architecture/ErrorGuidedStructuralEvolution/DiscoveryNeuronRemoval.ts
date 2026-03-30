/**
 * Neuron removal operations for discovery: removing harmful
 * and low-impact neurons based on discovery candidates.
 */

import { addTag, removeTag } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupOrphanedNeurons,
} from "@compact/CompactUtils.ts";
import { Creature } from "@creature";
import type { Approach } from "@neat/LogApproach.ts";
import type { CandidateHarmfulNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { getLogger } from "@utils/Logger.ts";
import { validateAndFixIfNeeded } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryValidation.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import {
  buildWireToRuntimeIdMap,
  resolveSingleNeuronReference,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";

/**
 * Removes a harmful neuron from the creature efficiently.
 * This method uses the average activation from discovery records to adjust
 * downstream neurons' biases, then removes all synapses and the neuron itself.
 * This is more efficient than the generic removeNeuron as it uses actual
 * activation data rather than just the bias.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param harmfulNeuron - The harmful neuron candidate to remove.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the neuron removed, or undefined if no change was made.
 */
export function removeHarmfulNeuron(
  ID: string,
  creature: Creature,
  harmfulNeuron?: CandidateHarmfulNeuron,
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!harmfulNeuron) return undefined;

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const harmfulNeuronId = resolveSingleNeuronReference(
    wireToId,
    harmfulNeuron.neuronUuid,
  );
  if (harmfulNeuronId === undefined) {
    return undefined;
  }
  const harmfulNeuronLabel = harmfulNeuron.neuronUuid;

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === harmfulNeuronLabel,
  );
  if (!neuronToRemove) {
    return undefined; // Neuron doesn't exist, nothing to remove
  }

  // Don't remove output neurons (input neurons don't exist in this type system)
  if (neuronToRemove.type === "output") {
    return undefined;
  }

  // Create a deep copy to modify
  const simplifiedExport: typeof exportJSON = JSON.parse(
    JSON.stringify(exportJSON),
  );

  // Find all downstream neurons (neurons that receive input from this neuron)
  const outgoingSynapses = simplifiedExport.synapses.filter(
    (synapse) => synapse.fromUUID === harmfulNeuronLabel,
  );

  // Adjust downstream neurons' biases using average activation * synapse weight
  // Accumulate all synapse weights for each target neuron before applying adjustment
  const averageActivation = harmfulNeuron.averageActivation;
  const weightSums = new Map<string, number>();

  // First pass: accumulate all synapse weights for each target neuron
  outgoingSynapses.forEach((synapse) => {
    const targetUuid = synapse.toUUID;
    if (!targetUuid) return;
    const currentWeightSum = weightSums.get(targetUuid) || 0;
    // Sum up weights for all synapses to the same target
    weightSums.set(
      targetUuid,
      currentWeightSum + synapse.weight,
    );
  });

  // Second pass: multiply by average activation once and apply the total bias adjustment
  weightSums.forEach((totalWeight, neuronUuid) => {
    const downstreamNeuron = simplifiedExport.neurons.find(
      (n) => n.uuid === neuronUuid,
    );
    if (downstreamNeuron) {
      // Apply the accumulated adjustment: averageActivation * (sum of weights)
      const totalAdjustment = averageActivation * totalWeight;
      downstreamNeuron.bias = (downstreamNeuron.bias || 0) + totalAdjustment;
    }
  });

  // Remove all synapses to/from this neuron
  simplifiedExport.synapses = simplifiedExport.synapses.filter(
    (synapse) =>
      synapse.fromUUID !== harmfulNeuronLabel &&
      synapse.toUUID !== harmfulNeuronLabel,
  );

  // Remove the neuron itself
  simplifiedExport.neurons = simplifiedExport.neurons.filter(
    (neuron) => neuron.uuid !== harmfulNeuronLabel,
  );

  // Integrity check: after removing neuron and its synapses
  assertValidSynapseReferences(
    simplifiedExport,
    "removeHarmfulNeuron after removal",
  );

  // Clean up memetic only when the removed neuron is referenced (issue #912;
  // matches SubNeuron / other mutation operators).
  cleanupMemeticForRemovedNeuron(simplifiedExport, harmfulNeuronLabel);

  // Clean up any neurons that have become orphaned (no outward connections)
  // This prevents validation failures when neurons that only connected to
  // the removed neuron are left dangling
  cleanupOrphanedNeurons(simplifiedExport);

  // Integrity check: after orphan cleanup
  assertValidSynapseReferences(
    simplifiedExport,
    "removeHarmfulNeuron after cleanup",
  );

  const tmpCreature = Creature.fromJSON(simplifiedExport);
  // We modified the structure, so we must delete UUID
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "remove-neuron",
    harmfulNeuron,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return undefined;
  }

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID) {
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    const summary = `🗑️ Removed harmful neuron ${harmfulNeuronLabel} (error: ${
      harmfulNeuron.errorMagnitude.toExponential(2)
    }, avg activation: ${averageActivation.toFixed(4)})`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }
  return undefined;
}

// Track removal diagnostics across calls (static to aggregate across multiple removals)
const removalDiagnostics = {
  sameUUIDCount: 0,
  firstSameUUIDLogged: false,
};

/**
 * Removes a low-impact neuron from the creature.
 * Unlike removeHarmfulNeuron, this doesn't require averageActivation for bias adjustment
 * since low-impact neurons (by definition) have negligible effect on downstream neurons.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param removalCandidate - The low-impact neuron candidate to remove.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the neuron removed, or undefined if no change was made.
 */
export function removeLowImpactNeuron(
  ID: string,
  creature: Creature,
  removalCandidate?: import("./DiscoverResult.ts").RemovalCandidate,
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!removalCandidate) return undefined;

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const removalNeuronId = resolveSingleNeuronReference(
    wireToId,
    removalCandidate.neuronUuid,
  );
  if (removalNeuronId === undefined) {
    return undefined;
  }
  const removalLabel = removalCandidate.neuronUuid;

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === removalLabel,
  );
  if (!neuronToRemove) {
    return undefined; // Neuron doesn't exist, nothing to remove
  }

  // Don't remove output neurons
  if (neuronToRemove.type === "output") {
    return undefined;
  }

  // Create a deep copy to modify
  const simplifiedExport: typeof exportJSON = JSON.parse(
    JSON.stringify(exportJSON),
  );

  const originalSynapseCount = simplifiedExport.synapses.length;
  const originalNeuronCount = simplifiedExport.neurons.length;

  // Bias compensation (average-preserving ablation):
  // For each outgoing synapse X -> T with weight w, removing X deletes an average
  // contribution of (w * meanActivation(X)) from T's pre-activation sum.
  // Compensate by adjusting T.bias += w * meanActivation(X) for all targets T.
  const meanActivation = removalCandidate.meanActivation;
  if (typeof meanActivation === "number" && Number.isFinite(meanActivation)) {
    const outgoing = simplifiedExport.synapses.filter(
      (synapse) => synapse.fromUUID === removalLabel,
    );

    if (outgoing.length > 0) {
      const weightSumsByTarget = new Map<string, number>();
      for (const synapse of outgoing) {
        const targetUuid = synapse.toUUID;
        if (!targetUuid || targetUuid === removalLabel) continue;
        weightSumsByTarget.set(
          targetUuid,
          (weightSumsByTarget.get(targetUuid) ?? 0) + synapse.weight,
        );
      }

      for (const [targetUuid, weightSum] of weightSumsByTarget) {
        const target = simplifiedExport.neurons.find((n) =>
          n.uuid === targetUuid
        );
        if (!target) continue;
        target.bias = (target.bias ?? 0) + (weightSum * meanActivation);
      }
    }
  }

  // Remove all synapses to/from this neuron.
  simplifiedExport.synapses = simplifiedExport.synapses.filter(
    (synapse) =>
      synapse.fromUUID !== removalLabel &&
      synapse.toUUID !== removalLabel,
  );

  // Remove the neuron itself
  simplifiedExport.neurons = simplifiedExport.neurons.filter(
    (neuron) => neuron.uuid !== removalLabel,
  );

  // Integrity check: after removing neuron and its synapses
  assertValidSynapseReferences(
    simplifiedExport,
    "removeLowImpactNeuron after removal",
  );

  cleanupMemeticForRemovedNeuron(simplifiedExport, removalLabel);

  // Clean up any neurons that have become orphaned (no outward connections)
  // This prevents validation failures when neurons that only connected to
  // the removed neuron are left dangling
  cleanupOrphanedNeurons(simplifiedExport);

  // Integrity check: after orphan cleanup
  assertValidSynapseReferences(
    simplifiedExport,
    "removeLowImpactNeuron after cleanup",
  );

  const removedSynapseCount = originalSynapseCount -
    simplifiedExport.synapses.length;
  const removedNeuronCount = originalNeuronCount -
    simplifiedExport.neurons.length;

  const tmpCreature = Creature.fromJSON(simplifiedExport);
  // We modified the structure, so we must delete UUID
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "remove-low-impact",
    removalCandidate,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return undefined;
  }

  // Check if fix() re-added any structure
  const afterFixSynapseCount = tmpCreature.synapses.length;
  const afterFixNeuronCount = tmpCreature.neurons.length;
  const fixReaddedSynapses = afterFixSynapseCount -
    simplifiedExport.synapses.length;
  const fixReaddedNeurons = afterFixNeuronCount -
    simplifiedExport.neurons.length;

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID) {
    // Reset diagnostics on successful removal
    removalDiagnostics.sameUUIDCount = 0;
    removalDiagnostics.firstSameUUIDLogged = false;

    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    const summary = `🪶 Removed low-impact neuron ${removalLabel} (error: ${
      removalCandidate.totalError.toFixed(4)
    }, impact: ${(removalCandidate.impact * 100).toFixed(2)}%)`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }

  // UUID didn't change - track this case
  removalDiagnostics.sameUUIDCount++;

  // Log detailed diagnostics for first occurrence only
  if (!removalDiagnostics.firstSameUUIDLogged) {
    removalDiagnostics.firstSameUUIDLogged = true;
    getLogger().warn(
      `[DiscoverStructure] removeLowImpactNeuron UUID unchanged after removal:`,
      `\n  neuronId: ${removalLabel}`,
      `\n  removedSynapses: ${removedSynapseCount}, removedNeurons: ${removedNeuronCount}`,
      `\n  fix() re-added: synapses=${fixReaddedSynapses}, neurons=${fixReaddedNeurons}`,
      `\n  originalUUID: ${creatureUUID}`,
      `\n  newUUID: ${tmpUUID}`,
    );
  }

  return undefined;
}

/** Reset removal diagnostics (call at start of discovery to get fresh stats). */
export function resetRemovalDiagnostics(): void {
  removalDiagnostics.sameUUIDCount = 0;
  removalDiagnostics.firstSameUUIDLogged = false;
}

/** Get count of removals that failed due to same UUID. */
export function getRemovalSameUUIDCount(): number {
  return removalDiagnostics.sameUUIDCount;
}
