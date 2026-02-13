/**
 * Static methods for applying discovery results to creatures.
 *
 * These methods modify creature structures by adding/removing synapses, neurons,
 * or changing squash functions based on discovery candidates.
 */

import { addTag, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil } from "../../../mod.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupOrphanedNeurons,
} from "../../compact/CompactUtils.ts";
import { Creature } from "../../Creature.ts";
import type { Approach } from "../../NEAT/LogApproach.ts";
import { memeticUpdate } from "../../blackbox/MemeticUpdate.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructureTypes.ts";
import { ensureDirSync } from "@std/fs";
import { join } from "@std/path";
import { getLogger } from "../../utils/Logger.ts";

/**
 * Validates a creature and attempts to fix it if validation fails.
 * If validation fails and discoveryFailureCacheDir is specified, records the issue
 * to an "issues" subdirectory for later debugging.
 *
 * @param creature - The creature to validate (modified in place if fix is needed).
 * @param originalCreature - The original creature before modifications.
 * @param discoveryID - Unique identifier for the discovery process.
 * @param operationType - Type of operation (e.g., "add-synapses", "remove-neuron").
 * @param candidate - The discovery candidate that caused the modification.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns Result indicating success/failure and whether fix was called.
 */
export function validateAndFixIfNeeded(
  creature: Creature,
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  candidate: unknown,
  discoveryFailureCacheDir?: string,
): { success: boolean; fixWasCalled: boolean; validationError?: Error } {
  const enforceForwardOnly = originalCreature.forwardOnly === true;

  const bumpToFourIfForwardOnlyConfirmed = () => {
    const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(creature.semanticVersion);
    if (!match) return;
    const major = Number.parseInt(match[1], 10);
    if (Number.isNaN(major)) return;
    // Backwards compatibility: never downgrade.
    if (major === 2 || major === 3) {
      creature.semanticVersion = "4.0.0";
    }
  };

  // First attempt validation
  try {
    if (enforceForwardOnly) {
      creature.validate({ forwardOnly: true });
      creature.forwardOnly = true;
      bumpToFourIfForwardOnlyConfirmed();
    } else {
      creature.validate();
    }
    return { success: true, fixWasCalled: false };
  } catch (validationError) {
    const error = validationError as Error;

    // Log the validation issue if discoveryFailureCacheDir is specified
    if (discoveryFailureCacheDir) {
      recordValidationIssue(
        creature,
        originalCreature,
        discoveryID,
        operationType,
        candidate,
        error,
        discoveryFailureCacheDir,
      );
    }

    getLogger().warn(
      `[Discovery ${discoveryID}] Creature became invalid after ${operationType}: ${error.name} - ${error.message}. ` +
        `This is a bug that should be investigated. Attempting fix() as last resort.`,
    );

    // Attempt to fix the creature.
    // If the original creature is forward-only, ensure we repair by removing recurrent connections.
    if (enforceForwardOnly) {
      creature.fix({ forwardOnly: true });
    } else {
      creature.fix();
    }

    // Re-validate after fix
    try {
      if (enforceForwardOnly) {
        creature.validate({ forwardOnly: true });
        creature.forwardOnly = true;
        bumpToFourIfForwardOnlyConfirmed();
      } else {
        creature.validate();
      }
      return { success: true, fixWasCalled: true, validationError: error };
    } catch (fixError) {
      getLogger().error(
        `[Discovery ${discoveryID}] fix() failed to repair creature after ${operationType}. Error: ${fixError}`,
      );
      return { success: false, fixWasCalled: true, validationError: error };
    }
  }
}

/**
 * Records a validation issue to the issues subdirectory for debugging.
 * Creates a unique directory containing all information needed to reproduce the issue.
 */
function recordValidationIssue(
  invalidCreature: Creature,
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  candidate: unknown,
  error: Error,
  discoveryFailureCacheDir: string,
): void {
  try {
    // Create timestamp in Australian format (yyyymmdd-HHmmss)
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);

    // Create unique directory for this issue
    const issueDir = join(
      discoveryFailureCacheDir,
      "issues",
      `${timestamp}-${discoveryID}-${operationType}`,
    );
    ensureDirSync(issueDir);

    // Save the candidate
    const candidatePath = join(issueDir, "candidate.json");
    Deno.writeTextFileSync(
      candidatePath,
      JSON.stringify(candidate, null, 2),
    );

    // Save the original creature
    const originalPath = join(issueDir, "original-creature.json");
    Deno.writeTextFileSync(
      originalPath,
      JSON.stringify(originalCreature.exportJSON(), null, 2),
    );

    // Save the invalid creature (before fix)
    const invalidPath = join(issueDir, "invalid-creature.json");
    Deno.writeTextFileSync(
      invalidPath,
      JSON.stringify(invalidCreature.exportJSON(), null, 2),
    );

    // Save the error details
    const errorPath = join(issueDir, "error.txt");
    const errorContent = [
      `Validation Error Report`,
      `=======================`,
      ``,
      `Timestamp: ${now.toISOString()}`,
      `Discovery ID: ${discoveryID}`,
      `Operation Type: ${operationType}`,
      ``,
      `Error Name: ${error.name}`,
      `Error Message: ${error.message}`,
      ``,
      `Stack Trace:`,
      error.stack ?? "No stack trace available",
    ].join("\n");
    Deno.writeTextFileSync(errorPath, errorContent);

    getLogger().warn(
      `[Discovery ${discoveryID}] Validation issue recorded to: ${issueDir}`,
    );
  } catch (recordError) {
    // Don't let recording failure prevent the main flow
    getLogger().error(
      `[Discovery ${discoveryID}] Failed to record validation issue: ${recordError}`,
    );
  }
}

/**
 * Records a discovery issue to the issues subdirectory for debugging.
 *
 * This is used for cases where the creature may still validate, but the discovery
 * candidate is logically broken for our forward-pass evaluation ordering (eg,
 * a candidate proposes a from -> to link where the "from" neuron is after the
 * target neuron in the evaluation order, making the new neuron's activation
 * effectively zero at that stage).
 */
export function recordDiscoveryIssue(
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  issueType: string,
  details: unknown,
  discoveryFailureCacheDir: string,
): void {
  try {
    // Create timestamp in Australian format (yyyymmdd-HHmmss)
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);

    const issueDir = join(
      discoveryFailureCacheDir,
      "issues",
      `${timestamp}-${discoveryID}-${operationType}-${issueType}`,
    );
    ensureDirSync(issueDir);

    const detailsPath = join(issueDir, "candidate.json");
    Deno.writeTextFileSync(detailsPath, JSON.stringify(details, null, 2));

    const originalPath = join(issueDir, "original-creature.json");
    Deno.writeTextFileSync(
      originalPath,
      JSON.stringify(originalCreature.exportJSON(), null, 2),
    );

    const errorPath = join(issueDir, "error.txt");
    const detailsRecord = details as Record<string, unknown> | null;
    const message =
      detailsRecord && typeof detailsRecord["message"] === "string"
        ? detailsRecord["message"]
        : undefined;
    const fromIndex =
      detailsRecord && typeof detailsRecord["fromIndex"] === "number"
        ? detailsRecord["fromIndex"]
        : undefined;
    const targetIndex = detailsRecord &&
        typeof detailsRecord["targetIndex"] === "number"
      ? detailsRecord["targetIndex"]
      : undefined;
    const errorContent = [
      `Discovery Issue Report`,
      `======================`,
      ``,
      `Timestamp: ${now.toISOString()}`,
      `Discovery ID: ${discoveryID}`,
      `Operation Type: ${operationType}`,
      `Issue Type: ${issueType}`,
      ``,
      `Summary: Candidate is incompatible with forward-pass evaluation ordering.`,
      message ? `Message: ${message}` : undefined,
      fromIndex !== undefined ? `fromIndex: ${fromIndex}` : undefined,
      targetIndex !== undefined ? `targetIndex: ${targetIndex}` : undefined,
    ].filter((line) => line !== undefined).join("\n");
    Deno.writeTextFileSync(errorPath, errorContent);

    getLogger().warn(
      `[Discovery ${discoveryID}] Discovery issue recorded to: ${issueDir}`,
    );
  } catch (recordError) {
    // Don't let recording failure prevent the main flow
    getLogger().error(
      `[Discovery ${discoveryID}] Failed to record discovery issue: ${recordError}`,
    );
  }
}

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

  // Find the synapse indices in the creature
  const fromNeuron = creature.neurons.find(
    (n) => n.uuid === worseCandidate.fromNeuronUUID,
  );
  const toNeuron = creature.neurons.find(
    (n) => n.uuid === worseCandidate.toNeuronUUID,
  );

  if (!fromNeuron || !toNeuron) {
    getLogger().warn(
      `[DiscoverStructure] removeSynapse: neuron(s) not found for synapse ${worseCandidate.fromNeuronUUID} -> ${worseCandidate.toNeuronUUID}`,
    );
    return null;
  }

  const fromIndx = fromNeuron.index;
  const toIndx = toNeuron.index;

  // Check if the synapse actually exists
  const synapse = creature.getSynapse(fromIndx, toIndx);
  if (!synapse) {
    getLogger().warn(
      `[DiscoverStructure] removeSynapse: synapse ${worseCandidate.fromNeuronUUID} -> ${worseCandidate.toNeuronUUID} does not exist in creature`,
    );
    return null;
  }

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  exportJSON.synapses = exportJSON.synapses.filter((s) => {
    return s.fromUUID !== worseCandidate.fromNeuronUUID ||
      s.toUUID !== worseCandidate.toNeuronUUID;
  });

  // Clean up any neurons that have become orphaned after synapse removal.
  // This handles both:
  // - Converting hidden neurons with no inward connections to constants
  // - Removing hidden/constant neurons with no outward connections
  cleanupOrphanedNeurons(exportJSON);

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
    const summary =
      `☣️ Removed harmful synapse ${worseCandidate.fromNeuronUUID} -> ${worseCandidate.toNeuronUUID}`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }

  // Synapse existed but removal didn't change UUID
  getLogger().warn(
    `[DiscoverStructure] removeSynapse: synapse ${worseCandidate.fromNeuronUUID} -> ${worseCandidate.toNeuronUUID} existed but removal had no structural effect`,
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

  const appliedSynapses: CandidateSynapse[] = [];

  helpfulSynapses.forEach((bestCandidate) => {
    const foundSynapse = exportJSON.synapses.find((synapse) => {
      return synapse.fromUUID === bestCandidate.fromNeuronUUID &&
        synapse.toUUID === bestCandidate.toNeuronUUID;
    });

    if (foundSynapse) {
      getLogger().warn(
        `[Discovery ${ID}] Synapse ${bestCandidate.fromNeuronUUID} -> ${bestCandidate.toNeuronUUID} already exists, skipping`,
      );
      return;
    }

    const foundFromNeuron = exportJSON.neurons.find((neuron) => {
      return neuron.uuid === bestCandidate.fromNeuronUUID;
    });
    if (!foundFromNeuron) {
      if (!bestCandidate.fromNeuronUUID.startsWith("input-")) {
        getLogger().warn(
          `[Discovery ${ID}] Source neuron ${bestCandidate.fromNeuronUUID} not found, skipping synapse`,
        );
        return;
      }
    }
    const foundToNeuron = exportJSON.neurons.find((neuron) => {
      /** may have converted a hidden neuron to a constant */
      if (neuron.type !== "hidden" && neuron.type !== "output") return false;
      return neuron.uuid === bestCandidate.toNeuronUUID;
    });
    if (!foundToNeuron) {
      getLogger().warn(
        `[Discovery ${ID}] Target neuron ${bestCandidate.toNeuronUUID} not found or is not hidden/output, skipping synapse`,
      );
      return;
    }

    const addSynapse = {
      fromUUID: bestCandidate.fromNeuronUUID,
      toUUID: bestCandidate.toNeuronUUID,
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
      ? `🕵🏻‍♂️ Added helpful synapse ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID}`
      : `🕵🏻‍♂️ Added ${appliedSynapses.length} helpful synapses (eg ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID})`;
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

  const existingNeuronUUIDs = new Set(
    exportJSON.neurons.map((neuron) => neuron.uuid),
  );
  const processedKeys = new Set<string>();
  const addedNeuronUUIDs: string[] = [];
  const appliedCandidates: CandidateNeuron[] = [];

  helpfulNeurons.forEach((candidate) => {
    const key = `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
    if (processedKeys.has(key)) return;
    processedKeys.add(key);

    const sourceExists = existingNeuronUUIDs.has(candidate.fromNeuronUUID) ||
      candidate.fromNeuronUUID.startsWith("input-");
    if (!sourceExists) return;

    const targetNeuron = exportJSON.neurons.find((neuron) => {
      if (neuron.type !== "hidden" && neuron.type !== "output") return false;
      return neuron.uuid === candidate.toNeuronUUID;
    });
    if (!targetNeuron) return;

    // Guard: ensure the source neuron is evaluated before the target neuron.
    //
    // This should always be true for Rust-proposed add-neuron candidates in a
    // feed-forward creature. If it isn't, the new neuron's activation will be
    // computed before its inputs are available, making the mutation ineffective
    // (activation looks like zero at that stage).
    const fromIndex = candidate.fromNeuronUUID.startsWith("input-")
      ? -1
      : exportJSON.neurons.findIndex((n) =>
        n.uuid === candidate.fromNeuronUUID
      );
    const toIndex = exportJSON.neurons.findIndex((n) =>
      n.uuid === candidate.toNeuronUUID
    );

    if (fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex) {
      const summary =
        `from neuron must be before target neuron (fromIndex=${fromIndex}, targetIndex=${toIndex})`;
      getLogger().warn(
        `[Discovery ${ID}] addHelpfulNeurons: Skipping candidate ${candidate.fromNeuronUUID} -> ${candidate.toNeuronUUID}: ${summary}`,
      );

      if (discoveryFailureCacheDir) {
        recordDiscoveryIssue(
          creature,
          ID,
          "add-neurons",
          "ordering",
          {
            message: summary,
            fromNeuronUUID: candidate.fromNeuronUUID,
            toNeuronUUID: candidate.toNeuronUUID,
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

    const newNeuronUUID = `hidden-discovery-${crypto.randomUUID()}`;
    const newNeuron = {
      type: "hidden" as const,
      uuid: newNeuronUUID,
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
      neuron.uuid === candidate.toNeuronUUID
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
    existingNeuronUUIDs.add(newNeuronUUID);
    addedNeuronUUIDs.push(newNeuronUUID);
    appliedCandidates.push(candidate);

    const incomingSynapse = {
      fromUUID: candidate.fromNeuronUUID,
      toUUID: newNeuronUUID,
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
      fromUUID: newNeuronUUID,
      toUUID: candidate.toNeuronUUID,
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

  if (addedNeuronUUIDs.length === 0) {
    getLogger().warn(
      `[Discovery ${ID}] No neurons could be added from ${helpfulNeurons.length} candidates`,
    );
    return;
  }

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
        ? `🕵🏻‍♂️ Added discovery neuron linking ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID}`
        : `🕵🏻‍♂️ Added ${appliedCandidates.length} discovery neurons (eg ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID})`;
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

  const appliedSquashes: CandidateSquash[] = [];

  helpfulSquashes.forEach((bestCandidate) => {
    const foundNeuron = exportJSON.neurons.find((neuron) => {
      return neuron.uuid === bestCandidate.neuronUUID;
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
        ? `🕵🏻‍♂️ Swapped ${exemplar.neuronUUID} squash to ${exemplar.squash}`
        : `🕵🏻‍♂️ Updated squash on ${appliedSquashes.length} neurons (eg ${exemplar.neuronUUID} -> ${exemplar.squash})`;
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

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === harmfulNeuron.neuronUUID,
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
    (synapse) => synapse.fromUUID === harmfulNeuron.neuronUUID,
  );

  // Adjust downstream neurons' biases using average activation * synapse weight
  // Accumulate all synapse weights for each target neuron before applying adjustment
  const averageActivation = harmfulNeuron.averageActivation;
  const weightSums = new Map<string, number>();

  // First pass: accumulate all synapse weights for each target neuron
  outgoingSynapses.forEach((synapse) => {
    const currentWeightSum = weightSums.get(synapse.toUUID) || 0;
    // Sum up weights for all synapses to the same target
    weightSums.set(
      synapse.toUUID,
      currentWeightSum + synapse.weight,
    );
  });

  // Second pass: multiply by average activation once and apply the total bias adjustment
  weightSums.forEach((totalWeight, neuronUUID) => {
    const downstreamNeuron = simplifiedExport.neurons.find(
      (n) => n.uuid === neuronUUID,
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
      synapse.fromUUID !== harmfulNeuron.neuronUUID &&
      synapse.toUUID !== harmfulNeuron.neuronUUID,
  );

  // Remove the neuron itself
  simplifiedExport.neurons = simplifiedExport.neurons.filter(
    (neuron) => neuron.uuid !== harmfulNeuron.neuronUUID,
  );

  // Clean up any neurons that have become orphaned (no outward connections)
  // This prevents validation failures when neurons that only connected to
  // the removed neuron are left dangling
  cleanupOrphanedNeurons(simplifiedExport);

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
    const summary =
      `🗑️ Removed harmful neuron ${harmfulNeuron.neuronUUID} (error: ${
        harmfulNeuron.errorMagnitude.toExponential(2)
      }, avg activation: ${averageActivation.toFixed(4)})`;
    addTag(tmpCreature, "Discovery", summary);
    delete tmpCreature.memetic;
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

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === removalCandidate.neuronUUID,
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
      (synapse) => synapse.fromUUID === removalCandidate.neuronUUID,
    );

    if (outgoing.length > 0) {
      const weightSumsByTarget = new Map<string, number>();
      for (const synapse of outgoing) {
        if (synapse.toUUID === removalCandidate.neuronUUID) continue;
        weightSumsByTarget.set(
          synapse.toUUID,
          (weightSumsByTarget.get(synapse.toUUID) ?? 0) + synapse.weight,
        );
      }

      for (const [targetUUID, weightSum] of weightSumsByTarget) {
        const target = simplifiedExport.neurons.find((n) =>
          n.uuid === targetUUID
        );
        if (!target) continue;
        target.bias = (target.bias ?? 0) + (weightSum * meanActivation);
      }
    }
  }

  // Remove all synapses to/from this neuron.
  simplifiedExport.synapses = simplifiedExport.synapses.filter(
    (synapse) =>
      synapse.fromUUID !== removalCandidate.neuronUUID &&
      synapse.toUUID !== removalCandidate.neuronUUID,
  );

  // Remove the neuron itself
  simplifiedExport.neurons = simplifiedExport.neurons.filter(
    (neuron) => neuron.uuid !== removalCandidate.neuronUUID,
  );

  // Clean up memetic data for the removed neuron (fixes issue #912)
  // This must be called before validation to prevent MEMETIC errors
  cleanupMemeticForRemovedNeuron(
    simplifiedExport,
    removalCandidate.neuronUUID,
  );

  // Clean up any neurons that have become orphaned (no outward connections)
  // This prevents validation failures when neurons that only connected to
  // the removed neuron are left dangling
  cleanupOrphanedNeurons(simplifiedExport);

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
    const summary =
      `🪶 Removed low-impact neuron ${removalCandidate.neuronUUID} (error: ${
        removalCandidate.totalError.toFixed(4)
      }, impact: ${(removalCandidate.impact * 100).toFixed(2)}%)`;
    addTag(tmpCreature, "Discovery", summary);
    delete tmpCreature.memetic;
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
      `\n  neuronUUID: ${removalCandidate.neuronUUID}`,
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
