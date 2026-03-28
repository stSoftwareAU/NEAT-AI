/**
 * Neuron addition and squash modification for discovery operations.
 *
 * Adds new neurons to creatures or changes existing neuron squash functions
 * based on discovery candidates.
 */

import { addTag, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Creature } from "../../Creature.ts";
import { nextNeuronId } from "../../architecture/NeuronId.ts";
import type { Approach } from "../../NEAT/LogApproach.ts";
import { memeticUpdate } from "../../blackbox/MemeticUpdate.ts";
import type {
  CandidateNeuron,
  CandidateSquash,
} from "./DiscoverStructureTypes.ts";
import { getLogger } from "../../utils/Logger.ts";
import {
  recordDiscoveryIssue,
  validateAndFixIfNeeded,
} from "./DiscoveryValidation.ts";
import { assertValidSynapseReferences } from "../../architecture/AssertValidSynapseReferences.ts";
import {
  buildWireToRuntimeIdMap,
  resolveCandidateNeuronEndpoints,
  resolveSingleNeuronReference,
} from "./DiscoveryWireIdentity.ts";

/**
 * Adds new neurons to the creature if they improve performance.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param helpfulNeurons - The candidate neurons to add.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the new neurons added, or undefined if no change was made.
 */
export function addHelpfulNeurons(
  ID: string,
  creature: Creature,
  helpfulNeurons?: CandidateNeuron[],
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!helpfulNeurons || helpfulNeurons.length === 0) return;
  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);

  const existingNeuronIds = new Set(
    creature.neurons.map((neuron) => neuron.id),
  );
  // Input neurons are not in exportJSON.neurons but are valid source neurons
  for (let i = 0; i < creature.input; i++) {
    existingNeuronIds.add(i);
  }
  const processedKeys = new Set<string>();
  const addedNeuronIds: number[] = [];
  const appliedCandidates: CandidateNeuron[] = [];

  helpfulNeurons.forEach((candidate) => {
    const key = `${candidate.fromNeuronUuid}->${candidate.toNeuronUuid}`;
    if (processedKeys.has(key)) return;
    processedKeys.add(key);

    const resolved = resolveCandidateNeuronEndpoints(wireToId, candidate);
    if (!resolved) return;

    const sourceExists = existingNeuronIds.has(resolved.fromId);
    if (!sourceExists) return;

    const targetNeuron = exportJSON.neurons.find((neuron) => {
      if (neuron.type !== "hidden" && neuron.type !== "output") return false;
      return neuron.uuid === candidate.toNeuronUuid;
    });
    if (!targetNeuron) return;

    // Guard: ensure the source neuron is evaluated before the target neuron.
    //
    // This should always be true for Rust-proposed add-neuron candidates in a
    // feed-forward creature. If it isn't, the new neuron's activation will be
    // computed before its inputs are available, making the mutation ineffective
    // (activation looks like zero at that stage).
    const fromIndex = resolved.fromId < creature.input
      ? -1
      : exportJSON.neurons.findIndex((n) =>
        n.uuid === candidate.fromNeuronUuid
      );
    const toIndex = exportJSON.neurons.findIndex((n) =>
      n.uuid === candidate.toNeuronUuid
    );

    if (fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex) {
      const summary =
        `from neuron must be before target neuron (fromIndex=${fromIndex}, targetIndex=${toIndex})`;
      getLogger().warn(
        `[Discovery ${ID}] addHelpfulNeurons: Skipping candidate ${candidate.fromNeuronUuid} -> ${candidate.toNeuronUuid}: ${summary}`,
      );

      if (discoveryFailureCacheDir) {
        recordDiscoveryIssue(
          creature,
          ID,
          "add-neurons",
          "ordering",
          {
            message: summary,
            fromNeuronUuid: candidate.fromNeuronUuid,
            toNeuronUuid: candidate.toNeuronUuid,
            fromIndex,
            targetIndex: toIndex,
            candidate,
            neuronOrder: exportJSON.neurons.map((n) => ({
              uuid: n.uuid,
              type: n.type,
            })),
          },
          discoveryFailureCacheDir,
        );
      }
      return;
    }

    const newNeuronId = nextNeuronId();
    const newNeuronUuid = crypto.randomUUID();
    const newNeuron = {
      type: "hidden" as const,
      uuid: newNeuronUuid,
      squash: candidate.squash,
      bias: candidate.bias,
    };
    addTag(newNeuron as TagsInterface, "discovered", candidate.squash);
    if (candidate.comment) {
      addTag(
        newNeuron as TagsInterface,
        "discovery-comment",
        candidate.comment,
      );
    }
    // Diagnostic tags for troubleshooting
    addTag(
      newNeuron as TagsInterface,
      "discovery-bias",
      candidate.bias.toString(),
    );
    addTag(
      newNeuron as TagsInterface,
      "discovery-incoming-weight",
      candidate.incomingWeight.toString(),
    );
    addTag(
      newNeuron as TagsInterface,
      "discovery-outgoing-weight",
      candidate.outgoingWeight.toString(),
    );
    // IMPORTANT: Insert location depends on target neuron type.
    //
    // - Hidden targets: insert BEFORE the target neuron. Otherwise the new -> target
    //   synapse becomes a backwards edge (later index -> earlier index) and cannot
    //   influence the forward pass. This shows up as pure cost-of-growth penalty
    //   (eg, -1.2e-7) with ~zero error reduction.
    //
    // - Output targets: insert BEFORE the FIRST output neuron (not directly before
    //   output-1 / output-2). Otherwise we'd place a hidden neuron between outputs,
    //   violating the invariant that outputs are contiguous at the end of the list.
    const firstOutputIndex = exportJSON.neurons.findIndex((neuron) =>
      neuron.type === "output"
    );
    const targetIndex = exportJSON.neurons.findIndex((neuron) =>
      neuron.uuid === candidate.toNeuronUuid
    );

    if (targetNeuron.type === "output") {
      if (firstOutputIndex >= 0) {
        exportJSON.neurons.splice(firstOutputIndex, 0, newNeuron);
      } else {
        // Shouldn't happen, but keep behaviour sane.
        exportJSON.neurons.push(newNeuron);
      }
    } else if (targetIndex >= 0) {
      exportJSON.neurons.splice(targetIndex, 0, newNeuron);
    } else if (firstOutputIndex >= 0) {
      // Fallback: keep hidden neurons before outputs.
      exportJSON.neurons.splice(firstOutputIndex, 0, newNeuron);
    } else {
      exportJSON.neurons.push(newNeuron);
    }
    existingNeuronIds.add(newNeuronId);
    addedNeuronIds.push(newNeuronId);
    appliedCandidates.push(candidate);

    const incomingSynapse = {
      fromUUID: candidate.fromNeuronUuid,
      toUUID: newNeuronUuid,
      weight: candidate.incomingWeight,
    };
    addTag(incomingSynapse as TagsInterface, "discoveryID", ID);
    addTag(incomingSynapse as TagsInterface, "discovery", "beneficial");
    if (candidate.comment) {
      addTag(
        incomingSynapse as TagsInterface,
        "discovery-comment",
        candidate.comment,
      );
    }
    exportJSON.synapses.push(incomingSynapse);

    const outgoingSynapse = {
      fromUUID: newNeuronUuid,
      toUUID: candidate.toNeuronUuid,
      weight: candidate.outgoingWeight,
    };
    addTag(outgoingSynapse as TagsInterface, "discoveryID", ID);
    addTag(outgoingSynapse as TagsInterface, "discovery", "beneficial");
    if (candidate.comment) {
      addTag(
        outgoingSynapse as TagsInterface,
        "discovery-comment",
        candidate.comment,
      );
    }
    exportJSON.synapses.push(outgoingSynapse);
  });

  if (addedNeuronIds.length === 0) {
    getLogger().warn(
      `[Discovery ${ID}] No neurons could be added from ${helpfulNeurons.length} candidates`,
    );
    return;
  }

  // Integrity check: verify no dangling references before constructing creature
  assertValidSynapseReferences(exportJSON, "addHelpfulNeurons before fromJSON");

  const tmpCreature = Creature.fromJSON(exportJSON);
  // We added neurons and synapses to the structure, so we must delete UUID to get a new one
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const beforeFixSynapseCount = tmpCreature.synapses.length;
  const beforeFixNeuronCount = tmpCreature.neurons.length;
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "add-neurons",
    appliedCandidates,
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
  if (tmpUUID !== creatureUUID) {
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    if (appliedCandidates.length > 0) {
      const exemplar = appliedCandidates[0];
      const summary = appliedCandidates.length === 1
        ? `🕵🏻‍♂️ Added discovery neuron linking ${exemplar.fromNeuronUuid} -> ${exemplar.toNeuronUuid}`
        : `🕵🏻‍♂️ Added ${appliedCandidates.length} discovery neurons (eg ${exemplar.fromNeuronUuid} -> ${exemplar.toNeuronUuid})`;
      addTag(tmpCreature, "Discovery", summary);
    }
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

/**
 * Adjust the squash function of a neuron to improve its performance.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param helpfulSquashes - The candidate squash functions to apply.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the new modified squash, or null if no change was made.
 */
export function changeSquash(
  ID: string,
  creature: Creature,
  helpfulSquashes?: CandidateSquash[],
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!helpfulSquashes || helpfulSquashes.length === 0) return;
  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);

  const appliedSquashes: CandidateSquash[] = [];

  helpfulSquashes.forEach((bestCandidate) => {
    const neuronId = resolveSingleNeuronReference(
      wireToId,
      bestCandidate.neuronUuid,
    );
    if (neuronId === undefined) return;
    const foundNeuron = exportJSON.neurons.find((neuron) => {
      return neuron.uuid === bestCandidate.neuronUuid;
    });

    if (!foundNeuron) return;
    if (foundNeuron.type !== "hidden" && foundNeuron.type !== "output") {
      return;
    }

    addTag(foundNeuron as TagsInterface, "discovered", bestCandidate.squash);

    foundNeuron.squash = bestCandidate.squash;
    appliedSquashes.push(bestCandidate);
  });

  if (appliedSquashes.length === 0) {
    getLogger().warn(
      `[Discovery ${ID}] No squash changes could be applied from ${helpfulSquashes.length} candidates`,
    );
    return;
  }

  // Integrity check: verify no dangling references before constructing creature
  assertValidSynapseReferences(exportJSON, "changeSquash before fromJSON");

  const tmpCreature = Creature.fromJSON(exportJSON);
  // We changed squash functions, so we must delete UUID to get a new one
  delete tmpCreature.uuid;

  // Validate and fix if needed
  // Squash changes should rarely (if ever) require fix(), but handle edge cases
  const beforeFixSynapseCount = tmpCreature.synapses.length;
  const beforeFixNeuronCount = tmpCreature.neurons.length;
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "change-squash",
    appliedSquashes,
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
  if (tmpUUID !== creatureUUID) {
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    if (appliedSquashes.length > 0) {
      const exemplar = appliedSquashes[0];
      const summary = appliedSquashes.length === 1
        ? `🕵🏻‍♂️ Swapped ${exemplar.neuronUuid} squash to ${exemplar.squash}`
        : `🕵🏻‍♂️ Updated squash on ${appliedSquashes.length} neurons (eg ${exemplar.neuronUuid} -> ${exemplar.squash})`;
      addTag(tmpCreature, "Discovery", summary);
    }
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
