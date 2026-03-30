/**
 * Synapse operations for discovery: adding and removing synapses
 * based on discovery candidates.
 */

import { addTag, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { cleanupOrphanedNeurons } from "../../compact/CompactUtils.ts";
import { Creature } from "../../Creature.ts";
import type { Approach } from "@neat/LogApproach.ts";
import { memeticUpdate } from "../../blackbox/MemeticUpdate.ts";
import type { CandidateSynapse } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { getLogger } from "@utils/Logger.ts";
import { validateAndFixIfNeeded } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryValidation.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import {
  buildWireToRuntimeIdMap,
  resolveCandidateSynapseEndpoints,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";

/**
 * Removes a synapse from the creature if it is determined to be harmful.
 * This method is used to prune synapses that consistently worsen prediction error.
 * @param ID - Unique identifier for the discovery process.
 * @param creature the Creature instance to modify.
 * @param worseCandidate the candidate synapse to remove.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns returns a modified Creature with the synapse removed, or null if no change was made.
 */
export function removeSynapse(
  ID: string,
  creature: Creature,
  worseCandidate?: CandidateSynapse,
  discoveryFailureCacheDir?: string,
): Creature | null {
  if (!worseCandidate) return null;
  const wireToId = buildWireToRuntimeIdMap(creature);
  const resolved = resolveCandidateSynapseEndpoints(wireToId, worseCandidate);
  const fromLabel = worseCandidate.fromNeuronUuid;
  const toLabel = worseCandidate.toNeuronUuid;
  if (!resolved) {
    getLogger().warn(
      `[DiscoverStructure] removeSynapse: neuron(s) not found for synapse ${fromLabel} -> ${toLabel}`,
    );
    return null;
  }

  // Find the synapse indices in the creature
  const fromNeuron = creature.neurons.find(
    (n) => n.id === resolved.fromId,
  );
  const toNeuron = creature.neurons.find(
    (n) => n.id === resolved.toId,
  );

  if (!fromNeuron || !toNeuron) {
    getLogger().warn(
      `[DiscoverStructure] removeSynapse: neuron(s) not found for synapse ${fromLabel} -> ${toLabel}`,
    );
    return null;
  }

  const fromIndx = fromNeuron.index;
  const toIndx = toNeuron.index;

  // Check if the synapse actually exists
  const synapse = creature.getSynapse(fromIndx, toIndx);
  if (!synapse) {
    getLogger().warn(
      `[DiscoverStructure] removeSynapse: synapse ${fromLabel} -> ${toLabel} does not exist in creature`,
    );
    return null;
  }

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  exportJSON.synapses = exportJSON.synapses.filter((s) => {
    return s.fromUUID !== fromLabel || s.toUUID !== toLabel;
  });

  // Integrity check: after filtering synapses, verify no dangling references
  assertValidSynapseReferences(exportJSON, "removeSynapse after filter");

  // Clean up any neurons that have become orphaned after synapse removal.
  // This handles both:
  // - Converting hidden neurons with no inward connections to constants
  // - Removing hidden/constant neurons with no outward connections
  cleanupOrphanedNeurons(exportJSON);

  // Integrity check: after orphan cleanup, verify no dangling references
  assertValidSynapseReferences(exportJSON, "removeSynapse after cleanup");

  const tmpCreature = Creature.fromJSON(exportJSON);
  // We modified the structure by filtering synapses, so we must delete UUID
  delete tmpCreature.uuid;
  delete tmpCreature.memetic;

  // Validate the creature - only call fix() as a last resort
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "remove-synapse",
    worseCandidate,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return null;
  }

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID) {
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    const summary = `☣️ Removed harmful synapse ${fromLabel} -> ${toLabel}`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }

  // Synapse existed but removal didn't change UUID
  getLogger().warn(
    `[DiscoverStructure] removeSynapse: synapse ${fromLabel} -> ${toLabel} existed but removal had no structural effect`,
  );
  return null;
}

/**
 * Adds a new synapse to the creature if it improves performance.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param helpfulSynapses - The candidate synapses to add.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the new synapse added, or undefined if no change was made.
 */
export function addHelpfulSynapses(
  ID: string,
  creature: Creature,
  helpfulSynapses?: CandidateSynapse[],
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!helpfulSynapses || helpfulSynapses.length === 0) return;
  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);

  const appliedSynapses: CandidateSynapse[] = [];

  helpfulSynapses.forEach((bestCandidate) => {
    const resolved = resolveCandidateSynapseEndpoints(wireToId, bestCandidate);
    const fromLabel = bestCandidate.fromNeuronUuid;
    const toLabel = bestCandidate.toNeuronUuid;
    if (!resolved) {
      getLogger().warn(
        `[Discovery ${ID}] Synapse endpoints ${fromLabel} -> ${toLabel} could not be resolved, skipping`,
      );
      return;
    }
    const foundSynapse = exportJSON.synapses.find((synapse) => {
      return synapse.fromUUID === fromLabel &&
        synapse.toUUID === toLabel;
    });

    if (foundSynapse) {
      getLogger().warn(
        `[Discovery ${ID}] Synapse ${fromLabel} -> ${toLabel} already exists, skipping`,
      );
      return;
    }

    const sourceExists = resolved.fromId < creature.input ||
      creature.neurons.some((neuron) => neuron.id === resolved.fromId);
    if (!sourceExists) {
      getLogger().warn(
        `[Discovery ${ID}] Source neuron ${fromLabel} not found, skipping synapse`,
      );
      return;
    }
    const foundToNeuron = exportJSON.neurons.find((neuron) => {
      /** may have converted a hidden neuron to a constant */
      if (neuron.type !== "hidden" && neuron.type !== "output") return false;
      return neuron.uuid === toLabel;
    });
    if (!foundToNeuron) {
      getLogger().warn(
        `[Discovery ${ID}] Target neuron ${toLabel} not found or is not hidden/output, skipping synapse`,
      );
      return;
    }

    const addSynapse = {
      fromUUID: bestCandidate.fromNeuronUuid,
      toUUID: bestCandidate.toNeuronUuid,
      weight: bestCandidate.weight,
    };

    // Tag the new synapse so it can be identified later and survives export/import.
    // This mirrors neuron tagging (see addHelpfulNeurons) and helps debug why
    // add-synapses candidates are (or are not) appearing in logs.
    addTag(addSynapse as TagsInterface, "discovered", "synapse");
    addTag(addSynapse as TagsInterface, "discovery", "beneficial");
    addTag(addSynapse as TagsInterface, "discoveryID", ID);
    if (bestCandidate.comment) {
      addTag(
        addSynapse as TagsInterface,
        "discovery-comment",
        bestCandidate.comment,
      );
    }
    exportJSON.synapses.push(addSynapse);
    appliedSynapses.push(bestCandidate);
  });

  if (appliedSynapses.length === 0) {
    getLogger().warn(
      `[Discovery ${ID}] No synapses could be added from ${helpfulSynapses.length} candidates`,
    );
    return;
  }

  // Integrity check: verify no dangling references before constructing creature
  assertValidSynapseReferences(
    exportJSON,
    "addHelpfulSynapses before fromJSON",
  );

  const tmpCreature = Creature.fromJSON(exportJSON);
  // We added synapses to the structure, so we must delete UUID to get a new one
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const beforeFixSynapseCount = tmpCreature.synapses.length;
  const beforeFixNeuronCount = tmpCreature.neurons.length;
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "add-synapses",
    appliedSynapses,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return;
  }
  const fixWasCalled = validationResult.fixWasCalled;

  // Log what fix() changed if it was called
  if (fixWasCalled) {
    const afterFixSynapseCount = tmpCreature.synapses.length;
    const afterFixNeuronCount = tmpCreature.neurons.length;
    if (
      afterFixSynapseCount !== beforeFixSynapseCount ||
      afterFixNeuronCount !== beforeFixNeuronCount
    ) {
      getLogger().warn(
        `[Discovery ${ID}] fix() modified structure: synapses ${beforeFixSynapseCount} -> ${afterFixSynapseCount}, neurons ${beforeFixNeuronCount} -> ${afterFixNeuronCount}`,
      );
    }
  }

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID && appliedSynapses.length > 0) {
    const exemplar = appliedSynapses[0];
    const summary = appliedSynapses.length === 1
      ? `🕵🏻‍♂️ Added helpful synapse ${exemplar.fromNeuronUuid} -> ${exemplar.toNeuronUuid}`
      : `🕵🏻‍♂️ Added ${appliedSynapses.length} helpful synapses (eg ${exemplar.fromNeuronUuid} -> ${exemplar.toNeuronUuid})`;
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    addTag(tmpCreature, "Discovery", summary);
    if (fixWasCalled) {
      addTag(tmpCreature, "discovery-fix-required", "true");
    }
    if (tmpCreature.memetic) {
      tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
    }

    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }
  return;
}
