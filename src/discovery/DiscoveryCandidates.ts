/**
 * Discovery Candidates Module
 *
 * This module builds discovery candidates from discovery results and applies changes
 * to creatures during two-phase scoring.
 *
 * **Validation Strategy:**
 *
 * We follow a strict validation-first approach to avoid creating broken creatures:
 *
 * 1. **Always validate first**: Every creature modification should call `validate()` before
 *    considering `fix()`. If validation passes, no fix is needed - this is the preferred path.
 *
 * 2. **Reuse battle-hardened logic**: The `src/mutate` classes contain well-tested logic
 *    for modifying creatures without breaking them. Where possible, we should reuse this
 *    logic (DRY principle) rather than reimplementing modification logic here.
 *
 * 3. **Fix() is a bug indicator**: If `validate()` fails and we must call `fix()`, this
 *    indicates a bug in our modification logic that should be addressed. Each `fix()` call
 *    should be treated as a bug report.
 *
 * 4. **Debug invalid creatures**: When validation fails, we log details and write the
 *    invalid creature to `.discovery/invalid-creatures/` for debugging. This helps identify
 *    patterns in modification logic that need improvement.
 *
 * 5. **Synchronous function**: The `validateAndFixCreatureSync()` function is used in
 *    synchronous contexts (like `applyChangeToCreature`). If async debug file writing
 *    is needed in the future, an async version can be added.
 *
 * **Goal**: Minimize `fix()` calls by improving modification logic to create valid
 * creatures from the start, following patterns from `src/mutate` classes.
 */

import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import {
  type CandidateHarmfulNeuron,
  type CandidateNeuron,
  type CandidateSquash,
  type CandidateSynapse,
  DiscoverStructure,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  DiscoverResult,
  RemovalCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
} from "../compact/CompactUtils.ts";
import { Creature } from "../Creature.ts";
import { ValidationError } from "../errors/ValidationError.ts";

/**
 * Extract the major version from a semantic version string.
 *
 * Invalid/undefined versions are treated as 0.
 */
function getMajorVersion(version: string | undefined): number {
  if (!version) return 0;
  const major = Number.parseInt(version.split(".")[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Determine whether forward-only must be enforced for this creature.
 *
 * - If `forwardOnly` is true, we must reject recurrent connections.
 * - If the creature is 4.x+, forward-only is a hard invariant.
 */
function shouldEnforceForwardOnly(creature: Creature): boolean {
  return creature.forwardOnly === true ||
    getMajorVersion(creature.semanticVersion) >= 4;
}

/**
 * Build a UUID → neuron index mapping from an exported creature JSON.
 *
 * Note: `CreatureExport.neurons` excludes input neurons. Its ordering matches the
 * creature's internal indices, offset by `input`.
 */
function buildUuidToIndexMap(
  creatureJSON: { input: number; neurons: Array<{ uuid: string }> },
): Map<string, number> {
  const uuidToIndex = new Map<string, number>();
  const inputCount = creatureJSON.input ?? 0;

  for (let i = 0; i < inputCount; i++) {
    uuidToIndex.set(`input-${i}`, i);
  }

  for (let i = 0; i < creatureJSON.neurons.length; i++) {
    uuidToIndex.set(creatureJSON.neurons[i].uuid, inputCount + i);
  }

  return uuidToIndex;
}

export type DiscoveryChangeType =
  | "add-synapses"
  | "add-neurons"
  | "remove-synapse"
  | "remove-neuron"
  | "remove-low-impact"
  | "change-squash"
  | "combo-add-remove"
  | "combo-add-change"
  | "combo-all"
  | "combo-best-of-category"
  | "combo-successful";

/** Details of a discovered neuron for logging/debugging. */
export interface DiscoveredNeuronDetails {
  /** Short ID of the newly added hidden neuron (from creature after adding). */
  addedNeuronShortID?: string;
  /** Source neuron UUID. */
  fromNeuronUUID: string;
  /** Target neuron UUID. */
  toNeuronUUID: string;
  /** Incoming weight (source -> new neuron). */
  incomingWeight: number;
  /** Outgoing weight (new neuron -> target). */
  outgoingWeight: number;
  /** Bias of the new neuron. */
  bias: number;
  /** Activation function (squash) of the new neuron. */
  squash: string;
}

/** Details of a synapse removal for caching/logging. */
export interface SynapseRemovalDetails {
  /** Source neuron UUID. */
  fromNeuronUUID: string;
  /** Target neuron UUID. */
  toNeuronUUID: string;
}

interface DiscoveryCandidateChange {
  type: DiscoveryChangeType;
  description?: string;
  expectedErrorReduction?: number;
  sampleSize?: number;
  /** Details of discovered neurons (for single neuron candidates). */
  neuronDetails?: DiscoveredNeuronDetails;
  /** Details of synapse removal (for synapse removal candidates). */
  synapseDetails?: SynapseRemovalDetails;
  /** Original Rust synapse candidate response (for add-synapses candidates). */
  synapseCandidate?: CandidateSynapse;
  /** Original Rust neuron candidate response (for add-neurons candidates). */
  neuronCandidate?: CandidateNeuron;
  /** Original Rust squash candidate response (for change-squash candidates). */
  squashCandidate?: CandidateSquash;
  /** Original Rust removal candidate response (for remove-low-impact candidates). */
  removalCandidate?: RemovalCandidate;
  /** Original harmful neuron candidate response (for remove-neuron candidates). */
  harmfulNeuronCandidate?: CandidateHarmfulNeuron;
  /** Original harmful synapse candidate response (for remove-synapse candidates). */
  harmfulSynapseCandidate?: CandidateSynapse;
}

export interface DiscoveryCandidate {
  creature: Creature;
  change: DiscoveryCandidateChange;
}

export interface BuildDiscoveryCandidatesOptions {
  /**
   * If true, skip building combined candidates.
   * Used for two-phase scoring where combos are built after evaluating singles.
   * @default false
   */
  skipCombinedCandidates?: boolean;

  /**
   * Directory path to cache discovery failures and log validation issues.
   * When provided, validation issues are recorded to an "issues" subdirectory.
   */
  discoveryFailureCacheDir?: string;
}

/**
 * Build a list of possible improved creatures based on discovery suggestions.
 *
 * This function mirrors the logic that previously lived in `Neat.ts`, but the
 * resulting creatures are now returned for external evaluation instead of being
 * applied directly to the population.
 *
 * @param baseCreature The creature to apply discovery changes to
 * @param discovery The discovery result containing candidate changes
 * @param options Options controlling candidate building
 */
export function buildDiscoveryCandidates(
  baseCreature: Creature,
  discovery: DiscoverResult,
  options?: BuildDiscoveryCandidatesOptions,
): DiscoveryCandidate[] {
  const skipCombos = options?.skipCombinedCandidates ?? false;
  const discoveryFailureCacheDir = options?.discoveryFailureCacheDir;
  // Ensure the base creature has a UUID so discovery helpers function correctly.
  CreatureUtil.makeUUID(baseCreature);

  // As of Rust v0.2.0, the expectedCreatureScoreGain returned by Rust is already
  // creature-level (impact already applied). TypeScript should use these values
  // directly without re-scaling. These helper functions are kept for API
  // compatibility but simply return the Rust-provided value.
  const getExpectedNeuron = (candidate: CandidateNeuron) =>
    candidate.expectedCreatureScoreGain;

  const getExpectedSynapse = (candidate: CandidateSynapse) =>
    candidate.expectedCreatureScoreGain;

  const getExpectedSquash = (candidate: CandidateSquash) =>
    candidate.expectedCreatureScoreGain;

  const getExpectedRemoval = (candidate?: CandidateSynapse) => {
    if (!candidate) return undefined;
    const value = candidate.expectedCreatureScoreGain;
    return value !== undefined ? Math.abs(value) : undefined;
  };

  const candidates: DiscoveryCandidate[] = [];

  const {
    addHelpfulSynapses,
    removeHarmfulSynapse,
    removeHarmfulNeurons,
    candidateSquashes,
  } = discovery;

  const helpfulNeuronCandidates = discovery.addHelpfulNeurons;
  const addedNeuronCreature = helpfulNeuronCandidates &&
      helpfulNeuronCandidates.length > 0
    ? DiscoverStructure.addHelpfulNeurons(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
      discoveryFailureCacheDir,
    )
    : undefined;
  if (addedNeuronCreature && helpfulNeuronCandidates) {
    const neuronSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        helpfulNeuronCandidates,
        getExpectedNeuron,
        (candidate) => candidate.totalCount,
      ),
    );
    candidates.push({
      creature: addedNeuronCreature,
      change: {
        type: "add-neurons",
        description:
          `💡 Added ${helpfulNeuronCandidates.length} helpful neuron${
            helpfulNeuronCandidates.length === 1 ? "" : "s"
          }`,
        expectedErrorReduction: neuronSummary.average,
        sampleSize: neuronSummary.sampleSize,
      },
    });
  } else if (helpfulNeuronCandidates && helpfulNeuronCandidates.length > 0) {
    console.info(
      `[DiscoveryCandidates] Combined add-neurons candidate not created (${helpfulNeuronCandidates.length} neuron${
        helpfulNeuronCandidates.length === 1 ? "" : "s"
      } suggested but structure change returned undefined)`,
    );
  }

  candidates.push(
    ...buildSingleNeuronCandidates(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
      getExpectedNeuron,
      discoveryFailureCacheDir,
    ),
  );

  const addedSynapseCreature = DiscoverStructure.addHelpfulSynapses(
    discovery.ID,
    baseCreature,
    addHelpfulSynapses,
    discoveryFailureCacheDir,
  );
  if (addedSynapseCreature) {
    const synapseSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        addHelpfulSynapses,
        getExpectedSynapse,
        (candidate) => candidate.totalCount,
      ),
    );
    candidates.push({
      creature: addedSynapseCreature,
      change: {
        type: "add-synapses",
        description: `🔗 Added ${
          addHelpfulSynapses?.length ?? 0
        } helpful synapse${(addHelpfulSynapses?.length ?? 0) === 1 ? "" : "s"}`,
        expectedErrorReduction: synapseSummary.average,
        sampleSize: synapseSummary.sampleSize,
      },
    });
  } else if (addHelpfulSynapses && addHelpfulSynapses.length > 0) {
    console.info(
      `[DiscoveryCandidates] Combined add-synapses candidate not created (${addHelpfulSynapses.length} synapse${
        addHelpfulSynapses.length === 1 ? "" : "s"
      } suggested but structure change returned undefined)`,
    );
  }

  candidates.push(
    ...buildSingleSynapseCandidates(
      discovery.ID,
      baseCreature,
      addHelpfulSynapses,
      getExpectedSynapse,
      discoveryFailureCacheDir,
    ),
  );

  const removedSynapseCreature = DiscoverStructure.removeSynapse(
    discovery.ID,
    baseCreature,
    removeHarmfulSynapse,
    discoveryFailureCacheDir,
  );
  if (removedSynapseCreature && removeHarmfulSynapse) {
    candidates.push({
      creature: removedSynapseCreature,
      change: {
        type: "remove-synapse",
        description: `✂️ Removed harmful synapse ${
          shortID(removeHarmfulSynapse.fromNeuronUUID)
        } -> ${shortID(removeHarmfulSynapse.toNeuronUUID)}`,
        expectedErrorReduction: getExpectedRemoval(removeHarmfulSynapse),
        sampleSize: removeHarmfulSynapse.totalCount,
        synapseDetails: {
          fromNeuronUUID: removeHarmfulSynapse.fromNeuronUUID,
          toNeuronUUID: removeHarmfulSynapse.toNeuronUUID,
        },
        // Store the original harmful synapse candidate for failure cache debugging
        harmfulSynapseCandidate: removeHarmfulSynapse,
      },
    });

    // Only build combined candidates if not skipped (for two-phase scoring)
    if (!skipCombos && addedSynapseCreature && removeHarmfulSynapse) {
      let combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        removedSynapseCreature,
        addHelpfulSynapses,
        discoveryFailureCacheDir,
      );
      if (combinedAddRemove) {
        // Ensure harmful synapse stays removed after adding synapses
        // (fix() might re-add it during addHelpfulSynapses)
        const removalUUID = {
          from: removeHarmfulSynapse.fromNeuronUUID,
          to: removeHarmfulSynapse.toNeuronUUID,
        };

        // Keep removing until it's definitely gone (fix() might re-add it)
        let currentCreature = combinedAddRemove;
        let attempts = 0;
        const maxAttempts = 10; // Prevent infinite loops

        while (attempts < maxAttempts) {
          const exportJSON = currentCreature.exportJSON();
          const originalCount = exportJSON.synapses.length;
          exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
            !(synapse.fromUUID === removalUUID.from &&
              synapse.toUUID === removalUUID.to)
          );

          if (exportJSON.synapses.length < originalCount) {
            // Clean up memetic data for the removed synapse
            cleanupMemeticForRemovedSynapse(
              exportJSON,
              removalUUID.from,
              removalUUID.to,
            );

            const updated = Creature.fromJSON(exportJSON);
            // We modified the structure by filtering synapses, so we must delete UUID
            delete updated.uuid;
            validateAndFixCreatureSync(updated, "remove-synapse");

            // Verify it's still removed after fix()
            const verifyJSON = updated.exportJSON();
            const stillExists = verifyJSON.synapses.some((synapse) =>
              synapse.fromUUID === removalUUID.from &&
              synapse.toUUID === removalUUID.to
            );

            if (!stillExists) {
              // Successfully removed and stayed removed
              currentCreature = updated;
              break;
            }
            // Still exists, try again
            currentCreature = updated;
          } else {
            // Synapse doesn't exist, we're done
            break;
          }
          attempts++;
        }

        combinedAddRemove = currentCreature;
        const count = addHelpfulSynapses?.length ?? 0;
        candidates.push({
          creature: combinedAddRemove,
          change: {
            type: "combo-add-remove",
            description:
              `🔧 Removed harmful synapse and added ${count} discovered helpful synapse${
                count === 1 ? "" : "s"
              }`,
          },
        });
      }
    }
  }

  const changedSquashCreature = DiscoverStructure.changeSquash(
    discovery.ID,
    baseCreature,
    candidateSquashes,
    discoveryFailureCacheDir,
  );
  if (changedSquashCreature) {
    const changes = (candidateSquashes || []).map((c) => {
      const neuron = baseCreature.neurons.find((n) => n.uuid === c.neuronUUID);
      const oldSquash = neuron?.squash;
      const improvementValue = getExpectedSquash(c);
      const improvement = improvementValue !== undefined
        ? ` expected: ${(improvementValue * 100).toFixed(1)}%`
        : "";
      return `${
        shortID(c.neuronUUID)
      } (${oldSquash} -> ${c.squash}${improvement})`;
    });

    const description = changes.length <= 3
      ? `🎨 Changed activation function for ${changes.join(", ")}`
      : `🎨 Changed activation function on ${changes.length} high-error neurons`;
    const squashSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(candidateSquashes, getExpectedSquash),
    );

    candidates.push({
      creature: changedSquashCreature,
      change: {
        type: "change-squash",
        description,
        expectedErrorReduction: squashSummary.average,
        sampleSize: squashSummary.sampleSize,
      },
    });

    // Only build combined candidates if not skipped (for two-phase scoring)
    if (!skipCombos && addedSynapseCreature) {
      const combinedAddChange = DiscoverStructure.changeSquash(
        discovery.ID,
        addedSynapseCreature,
        candidateSquashes,
        discoveryFailureCacheDir,
      );
      if (combinedAddChange) {
        const synCount = addHelpfulSynapses?.length ?? 0;
        const sqCount = candidateSquashes?.length ?? 0;
        candidates.push({
          creature: combinedAddChange,
          change: {
            type: "combo-add-change",
            description: `⚡ Added ${synCount} helpful synapse${
              synCount === 1 ? "" : "s"
            } and updated ${sqCount} neuron activation${
              sqCount === 1 ? "" : "s"
            }`,
          },
        });
      }
    }
  } else if (candidateSquashes && candidateSquashes.length > 0) {
    console.info(
      `[DiscoveryCandidates] Combined change-squash candidate not created (${candidateSquashes.length} squash${
        candidateSquashes.length === 1 ? "" : "es"
      } suggested but structure change returned undefined)`,
    );
  }

  candidates.push(
    ...buildSingleSquashCandidates(
      discovery.ID,
      baseCreature,
      candidateSquashes,
      getExpectedSquash,
      discoveryFailureCacheDir,
    ),
  );

  const removedNeuronCreature = removeHarmfulNeurons &&
      removeHarmfulNeurons.length > 0
    ? DiscoverStructure.removeHarmfulNeuron(
      discovery.ID,
      baseCreature,
      removeHarmfulNeurons[0],
      discoveryFailureCacheDir,
    )
    : undefined;
  if (removedNeuronCreature) {
    const mostHarmful = removeHarmfulNeurons![0];
    candidates.push({
      creature: removedNeuronCreature,
      change: {
        type: "remove-neuron",
        description: `💀 Removed harmful neuron ${
          shortID(mostHarmful.neuronUUID)
        } (error: ${mostHarmful.errorMagnitude.toExponential(2)})`,
        expectedErrorReduction: mostHarmful.expectedCreatureScoreGain,
        sampleSize: mostHarmful.sampleCount,
        // Store the original harmful neuron candidate for failure cache debugging
        harmfulNeuronCandidate: mostHarmful,
      },
    });
  }

  // Low-impact removal candidates (impact below costOfGrowth)
  // These neurons contribute essentially nothing to outputs - removing them improves
  // the creature's score because the complexity reduction benefit exceeds their contribution.
  //
  // NOTE: expectedErrorReduction is left undefined because:
  // 1. Removal doesn't reduce error - it may slightly increase it
  // 2. The improvement comes from score (complexity reduction), not error reduction
  // 3. The filter explicitly passes undefined through for evaluation
  //
  // INVESTIGATION NOTE (Dec 2025): Why might removing low-impact neurons INCREASE error?
  // Observed behaviour: neurons with impact < 1e-10 sometimes increase error when removed.
  // Potential causes:
  //   a) Structural impact calculation may not reflect runtime activation patterns accurately
  //   b) Neurons receiving signals that cancel out (net zero impact on path, but still contributing)
  //   c) The neuron's bias adjustment during removal may not perfectly compensate
  //   d) Non-linear interactions through downstream neurons may amplify small contributions
  // Potential mitigations:
  //   - Use stricter impact threshold (e.g., < 1e-12 instead of < 1e-10)
  //   - Verify with actual activation data before removal
  //   - Consider average activation magnitude in addition to structural impact
  const { removalCandidates } = discovery;

  if (removalCandidates && removalCandidates.length > 0) {
    let removalSuccessCount = 0;
    let removalFailureCount = 0;
    const failureReasons: Map<string, number> = new Map();

    for (const candidate of removalCandidates) {
      // Check if neuron exists in base creature
      const neuronExists = baseCreature.neurons.some(
        (n) => n.uuid === candidate.neuronUUID,
      );
      if (!neuronExists) {
        const reason = "neuron_not_found";
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        removalFailureCount++;
        continue;
      }

      const removedLowImpactCreature = DiscoverStructure.removeLowImpactNeuron(
        discovery.ID,
        baseCreature,
        candidate,
        discoveryFailureCacheDir,
      );
      if (removedLowImpactCreature) {
        removalSuccessCount++;
        candidates.push({
          creature: removedLowImpactCreature,
          change: {
            type: "remove-low-impact",
            description: `🪶 Removed neuron ${
              shortID(candidate.neuronUUID)
            } (impact: ${candidate.impact.toExponential(2)})`,
            // No expectedErrorReduction - removal improves score via complexity reduction, not error
            // Store the original Rust removal candidate for failure cache debugging
            removalCandidate: candidate,
          },
        });
      } else {
        const reason = "removal_returned_undefined";
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        removalFailureCount++;
      }
    }

    // Log diagnostic summary for removal candidates
    if (removalCandidates.length > 0) {
      const failureDetails = Array.from(failureReasons.entries())
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(", ");
      console.info(
        `[DiscoveryCandidates] Removal candidates: ${removalCandidates.length} total, ` +
          `${removalSuccessCount} succeeded, ${removalFailureCount} failed` +
          (failureDetails ? ` (${failureDetails})` : ""),
      );

      // Log detailed list of removal candidates sorted by impact (lowest first)
      // This helps identify if specific test neurons like "candidate-for-removal" are included
      const sortedByImpact = [...removalCandidates].sort((a, b) =>
        a.impact - b.impact
      );
      const topCandidates = sortedByImpact.slice(0, 10);
      const candidateDetails = topCandidates.map((c) =>
        `${shortID(c.neuronUUID)}:${c.impact.toExponential(2)}`
      ).join(", ");
      console.info(
        `[DiscoveryCandidates] Top ${topCandidates.length} lowest-impact removal candidates: ${candidateDetails}`,
      );

      // Check for specific test neuron patterns (e.g., containing "candidate-for-removal")
      // This helps verify test neurons are being properly identified
      const testNeuronMatches = removalCandidates.filter((c) =>
        c.neuronUUID.toLowerCase().includes("candidate") ||
        c.neuronUUID.toLowerCase().includes("test") ||
        c.neuronUUID.toLowerCase().includes("removal")
      );
      if (testNeuronMatches.length > 0) {
        console.info(
          `[DiscoveryCandidates] Found ${testNeuronMatches.length} potential test neuron(s) in removal list: ` +
            testNeuronMatches.map((c) =>
              `${c.neuronUUID}:${c.impact.toExponential(2)}`
            ).join(", "),
        );
      }
    }
  }

  // Only build combined candidates if not skipped (for two-phase scoring)
  if (!skipCombos) {
    const combinedCandidate = buildCombinedCandidate({
      baseCreature,
      discoveryID: discovery.ID,
      selection: {
        addHelpfulNeurons: addedNeuronCreature
          ? helpfulNeuronCandidates
          : undefined,
        addHelpfulSynapses: addedSynapseCreature
          ? addHelpfulSynapses
          : undefined,
        removeHarmfulSynapse: removedSynapseCreature
          ? removeHarmfulSynapse
          : undefined,
        removeHarmfulNeurons: removedNeuronCreature
          ? removeHarmfulNeurons
          : undefined,
        candidateSquashes: changedSquashCreature
          ? candidateSquashes
          : undefined,
      },
      changeType: "combo-all",
      description: "🏗️ Combined all discovery changes",
      discoveryFailureCacheDir,
    });
    if (combinedCandidate) {
      candidates.push(combinedCandidate);
    }

    const bestOfCategoryCandidate = buildBestOfCategoryCandidate(
      baseCreature,
      discovery,
      {
        synapse: getExpectedSynapse,
        neuron: getExpectedNeuron,
        squash: getExpectedSquash,
      },
      discoveryFailureCacheDir,
    );
    if (bestOfCategoryCandidate) {
      if (discovery.removeHarmfulSynapse) {
        // Always remove directly without checking first to ensure deterministic removal
        const removalUUID = {
          from: discovery.removeHarmfulSynapse.fromNeuronUUID,
          to: discovery.removeHarmfulSynapse.toNeuronUUID,
        };

        // Keep removing until it's definitely gone (fix() might re-add it)
        let currentCreature = bestOfCategoryCandidate.creature;
        let attempts = 0;
        const maxAttempts = 10; // Prevent infinite loops

        while (attempts < maxAttempts) {
          const exportJSON = currentCreature.exportJSON();
          const originalCount = exportJSON.synapses.length;
          exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
            !(synapse.fromUUID === removalUUID.from &&
              synapse.toUUID === removalUUID.to)
          );

          if (exportJSON.synapses.length < originalCount) {
            // Clean up memetic data for the removed synapse
            cleanupMemeticForRemovedSynapse(
              exportJSON,
              removalUUID.from,
              removalUUID.to,
            );

            const updated = Creature.fromJSON(exportJSON);
            // We modified the structure by filtering synapses, so we must delete UUID
            delete updated.uuid;
            validateAndFixCreatureSync(updated, "remove-synapse");

            // Verify it's still removed after fix()
            const verifyJSON = updated.exportJSON();
            const stillExists = verifyJSON.synapses.some((synapse) =>
              synapse.fromUUID === removalUUID.from &&
              synapse.toUUID === removalUUID.to
            );

            if (!stillExists) {
              // Successfully removed and stayed removed
              currentCreature = updated;
              break;
            }
            // Still exists, try again
            currentCreature = updated;
          } else {
            // Synapse doesn't exist, we're done
            break;
          }
          attempts++;
        }

        bestOfCategoryCandidate.creature = currentCreature;
      }
      candidates.push(bestOfCategoryCandidate);
    }
  }

  return candidates;
}

function buildSingleSynapseCandidates(
  discoveryID: string,
  baseCreature: Creature,
  synapses: CandidateSynapse[] | undefined,
  getExpected?: (synapse: CandidateSynapse) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!synapses || synapses.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const synapse of synapses) {
    const creature = DiscoverStructure.addHelpfulSynapses(
      discoveryID,
      baseCreature,
      [synapse],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }
    entries.push({
      creature,
      change: {
        type: "add-synapses",
        description: `🔗 Added helpful synapse ${
          shortID(synapse.fromNeuronUUID)
        } -> ${shortID(synapse.toNeuronUUID)}`,
        expectedErrorReduction: getExpected?.(synapse),
        sampleSize: synapse.totalCount,
        synapseCandidate: synapse, // Store original Rust response for debugging
      },
    });
  }
  if (skippedCount > 0) {
    console.info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${synapses.length} individual synapse candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

function buildSingleNeuronCandidates(
  discoveryID: string,
  baseCreature: Creature,
  neurons: CandidateNeuron[] | undefined,
  getExpected?: (neuron: CandidateNeuron) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!neurons || neurons.length === 0) return [];
  const baseNeuronUUIDs = new Set(baseCreature.neurons.map((n) => n.uuid));
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const neuron of neurons) {
    const creature = DiscoverStructure.addHelpfulNeurons(
      discoveryID,
      baseCreature,
      [neuron],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }

    // Find the newly added neuron by comparing with base creature
    const addedNeuron = creature.neurons.find(
      (n) => n.uuid && !baseNeuronUUIDs.has(n.uuid),
    );
    const addedNeuronShortID = addedNeuron?.uuid
      ? shortID(addedNeuron.uuid)
      : undefined;

    entries.push({
      creature,
      change: {
        type: "add-neurons",
        description: `💡 Added neuron ${
          shortID(neuron.fromNeuronUUID)
        } -> ${neuron.squash} -> ${shortID(neuron.toNeuronUUID)}`,
        expectedErrorReduction: getExpected?.(neuron),
        sampleSize: neuron.totalCount,
        neuronDetails: {
          addedNeuronShortID,
          fromNeuronUUID: neuron.fromNeuronUUID,
          toNeuronUUID: neuron.toNeuronUUID,
          incomingWeight: neuron.incomingWeight,
          outgoingWeight: neuron.outgoingWeight,
          bias: neuron.bias,
          squash: neuron.squash,
        },
        // Store the full Rust neuron candidate for failure cache debugging
        neuronCandidate: neuron,
      },
    });
  }
  if (skippedCount > 0) {
    console.info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${neurons.length} individual neuron candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

function buildSingleSquashCandidates(
  discoveryID: string,
  baseCreature: Creature,
  squashes: CandidateSquash[] | undefined,
  getExpected?: (squash: CandidateSquash) => number | undefined,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate[] {
  if (!squashes || squashes.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const squash of squashes) {
    const creature = DiscoverStructure.changeSquash(
      discoveryID,
      baseCreature,
      [squash],
      discoveryFailureCacheDir,
    );
    if (!creature) {
      skippedCount++;
      continue;
    }

    const neuron = baseCreature.neurons.find((n) =>
      n.uuid === squash.neuronUUID
    );
    const oldSquash = neuron?.squash;

    const scaledExpected = getExpected?.(squash);
    const improvement = scaledExpected !== undefined
      ? ` expected: ${(scaledExpected * 100).toFixed(1)}%`
      : "";
    entries.push({
      creature,
      change: {
        type: "change-squash",
        description: `🎨 Changed activation function for ${
          shortID(squash.neuronUUID)
        } (${oldSquash} -> ${squash.squash}${improvement})`,
        expectedErrorReduction: scaledExpected,
        squashCandidate: squash, // Store original Rust response for debugging
      },
    });
  }
  if (skippedCount > 0) {
    console.info(
      `[DiscoveryCandidates] Skipped ${skippedCount}/${squashes.length} individual squash candidate${
        skippedCount === 1 ? "" : "s"
      } (structure change returned undefined)`,
    );
  }
  return entries;
}

function summariseExpectedImprovement<
  T extends { expectedCreatureScoreGain: number; totalCount?: number },
>(
  entries?: readonly T[],
): { average?: number; sampleSize?: number } {
  if (!entries || entries.length === 0) return {};
  let weightedTotal = 0;
  let weightSum = 0;
  let sampleSize = 0;

  for (const entry of entries) {
    const value = entry.expectedCreatureScoreGain;
    if (Number.isFinite(value) === false) {
      continue;
    }
    const samples = Number.isFinite(entry.totalCount)
      ? Math.max(1, entry.totalCount ?? 1)
      : 1;
    weightedTotal += value * samples;
    weightSum += samples;
    if (Number.isFinite(entry.totalCount)) {
      sampleSize += entry.totalCount ?? 0;
    }
  }

  if (weightSum === 0) {
    return sampleSize > 0 ? { sampleSize } : {};
  }
  return {
    average: weightedTotal / weightSum,
    sampleSize: sampleSize > 0 ? sampleSize : undefined,
  };
}

function mapScaledSummaryEntries<T>(
  entries: readonly T[] | undefined,
  scale: (entry: T) => number | undefined,
  countSelector?: (entry: T) => number | undefined,
): Array<{ expectedCreatureScoreGain: number; totalCount?: number }> {
  if (!entries || entries.length === 0) return [];
  const mapped: Array<
    { expectedCreatureScoreGain: number; totalCount?: number }
  > = [];
  for (const entry of entries) {
    const scaled = scale(entry);
    if (scaled === undefined || Number.isFinite(scaled) === false) {
      continue;
    }
    mapped.push({
      expectedCreatureScoreGain: scaled,
      totalCount: countSelector ? countSelector(entry) : undefined,
    });
  }
  return mapped;
}

/** Returns the last 8 characters of a UUID or the full ID if short. */
export function shortID(id: string): string {
  if (id.length > 15 && id.includes("-")) {
    return id.slice(-8);
  }
  return id;
}

interface CombinedSelection {
  addHelpfulSynapses?: CandidateSynapse[];
  addHelpfulNeurons?: CandidateNeuron[];
  removeHarmfulSynapse?: CandidateSynapse;
  removeHarmfulNeurons?: CandidateHarmfulNeuron[];
  candidateSquashes?: CandidateSquash[];
}

interface CombinedCandidateArgs {
  baseCreature: Creature;
  discoveryID: string;
  selection: CombinedSelection;
  changeType: DiscoveryChangeType;
  description: string;
  discoveryFailureCacheDir?: string;
}

interface ScalingFunctions {
  synapse: (synapse: CandidateSynapse) => number | undefined;
  neuron: (neuron: CandidateNeuron) => number | undefined;
  squash: (squash: CandidateSquash) => number | undefined;
}

function buildCombinedCandidate(
  args: CombinedCandidateArgs,
): DiscoveryCandidate | undefined {
  const {
    baseCreature,
    discoveryID,
    selection,
    changeType,
    description,
    discoveryFailureCacheDir,
  } = args;

  const requestedCategories = [
    Boolean(selection.addHelpfulNeurons?.length),
    Boolean(selection.addHelpfulSynapses?.length),
    Boolean(selection.removeHarmfulSynapse),
    Boolean(selection.removeHarmfulNeurons?.length),
    Boolean(selection.candidateSquashes?.length),
  ].filter(Boolean).length;
  if (requestedCategories < 2) {
    return undefined;
  }

  let combinedCreature = baseCreature;
  const appliedLabels: string[] = [];

  const applyChange = (
    label: string,
    mutator: (() => Creature | undefined) | undefined,
  ) => {
    if (!mutator) return;
    const updated = mutator();
    if (updated && updated !== combinedCreature) {
      combinedCreature = updated;
      appliedLabels.push(label);
    }
  };

  applyChange(
    `add-neurons: ${selection.addHelpfulNeurons?.length ?? 0}`,
    selection.addHelpfulNeurons && selection.addHelpfulNeurons.length > 0
      ? () =>
        DiscoverStructure.addHelpfulNeurons(
          discoveryID,
          combinedCreature,
          selection.addHelpfulNeurons,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  applyChange(
    `add-synapses: ${selection.addHelpfulSynapses?.length ?? 0}`,
    selection.addHelpfulSynapses && selection.addHelpfulSynapses.length > 0
      ? () =>
        DiscoverStructure.addHelpfulSynapses(
          discoveryID,
          combinedCreature,
          selection.addHelpfulSynapses,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  applyChange(
    `change-squash: ${selection.candidateSquashes?.length ?? 0}`,
    selection.candidateSquashes && selection.candidateSquashes.length > 0
      ? () =>
        DiscoverStructure.changeSquash(
          discoveryID,
          combinedCreature,
          selection.candidateSquashes,
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  // Apply neuron removal before synapse removal
  applyChange(
    `remove-neuron: ${selection.removeHarmfulNeurons?.length ?? 0}`,
    selection.removeHarmfulNeurons &&
      selection.removeHarmfulNeurons.length > 0
      ? () =>
        DiscoverStructure.removeHarmfulNeuron(
          discoveryID,
          combinedCreature,
          selection.removeHarmfulNeurons![0],
          discoveryFailureCacheDir,
        )
      : undefined,
  );

  // Apply synapse removal last to ensure it happens even after other changes
  if (selection.removeHarmfulSynapse) {
    // Always remove directly without checking first to ensure deterministic removal
    // This avoids flakiness from timing issues or stale state checks
    const removalUUID = {
      from: selection.removeHarmfulSynapse.fromNeuronUUID,
      to: selection.removeHarmfulSynapse.toNeuronUUID,
    };

    // Keep removing until it's definitely gone (fix() might re-add it)
    let currentCreature = combinedCreature;
    let removed = false;
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loops

    while (attempts < maxAttempts) {
      const exportJSON = currentCreature.exportJSON();
      const originalCount = exportJSON.synapses.length;
      exportJSON.synapses = exportJSON.synapses.filter((synapse) =>
        !(synapse.fromUUID === removalUUID.from &&
          synapse.toUUID === removalUUID.to)
      );

      if (exportJSON.synapses.length < originalCount) {
        removed = true;
        // Clean up memetic data for the removed synapse
        cleanupMemeticForRemovedSynapse(
          exportJSON,
          removalUUID.from,
          removalUUID.to,
        );

        const updated = Creature.fromJSON(exportJSON);
        // We modified the structure by filtering synapses, so we must delete UUID
        delete updated.uuid;
        validateAndFixCreatureSync(updated, "remove-synapse");

        // Verify it's still removed after fix()
        const verifyJSON = updated.exportJSON();
        const stillExists = verifyJSON.synapses.some((synapse) =>
          synapse.fromUUID === removalUUID.from &&
          synapse.toUUID === removalUUID.to
        );

        if (!stillExists) {
          // Successfully removed and stayed removed
          currentCreature = updated;
          break;
        }
        // Still exists, try again
        currentCreature = updated;
      } else {
        // Synapse doesn't exist, we're done
        break;
      }
      attempts++;
    }

    if (removed) {
      combinedCreature = currentCreature;
      appliedLabels.push("remove-synapse");
    }
  }

  if (appliedLabels.length < 2 || combinedCreature === baseCreature) {
    return undefined;
  }

  return {
    creature: combinedCreature,
    change: {
      type: changeType,
      description: `${description} (${appliedLabels.join(", ")})`,
    },
  };
}

function buildBestOfCategoryCandidate(
  baseCreature: Creature,
  discovery: DiscoverResult,
  scaleFns: ScalingFunctions,
  discoveryFailureCacheDir?: string,
): DiscoveryCandidate | undefined {
  const bestSelection: CombinedSelection = {
    addHelpfulSynapses: wrapBestCandidate(
      discovery.addHelpfulSynapses,
      scaleFns.synapse,
    ),
    addHelpfulNeurons: wrapBestCandidate(
      discovery.addHelpfulNeurons,
      scaleFns.neuron,
    ),
    candidateSquashes: wrapBestCandidate(
      discovery.candidateSquashes,
      scaleFns.squash,
    ),
    removeHarmfulSynapse: discovery.removeHarmfulSynapse,
    removeHarmfulNeurons: discovery.removeHarmfulNeurons?.[0]
      ? [discovery.removeHarmfulNeurons[0]]
      : undefined,
  };

  return buildCombinedCandidate({
    baseCreature,
    discoveryID: discovery.ID,
    selection: bestSelection,
    changeType: "combo-best-of-category",
    description: "⭐ Combined best discovery changes",
    discoveryFailureCacheDir,
  });
}

function wrapBestCandidate<
  T extends { expectedCreatureScoreGain?: number },
>(
  entries: T[] | undefined,
  scoreSelector?: (entry: T) => number | undefined,
): T[] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const best = entries.reduce((currentBest: T | undefined, candidate) => {
    if (!currentBest) return candidate;
    const bestScore = scoreSelector
      ? scoreSelector(currentBest) ?? Number.NEGATIVE_INFINITY
      : currentBest.expectedCreatureScoreGain ?? Number.NEGATIVE_INFINITY;
    const candidateScore = scoreSelector
      ? scoreSelector(candidate) ?? Number.NEGATIVE_INFINITY
      : candidate.expectedCreatureScoreGain ?? Number.NEGATIVE_INFINITY;
    if (candidateScore > bestScore) {
      return candidate;
    }
    return currentBest;
  }, undefined);
  return best ? [best] : undefined;
}

/**
 * Build combined creatures from successful single candidates.
 *
 * This function is used in two-phase discovery scoring:
 * 1. Phase 1: Evaluate single candidates
 * 2. Phase 2: Call this function with successful candidates to create combinations
 *
 * Only combines candidates that have proven to improve score individually.
 * Generates multiple combination strategies to be evaluated in parallel:
 * - All successful candidates combined
 * - All removal candidates combined (if multiple exist)
 * - Pairwise combinations
 * - Triple combinations (for larger candidate sets)
 *
 * Since creature modifications can have unexpected results, we generate multiple
 * combinations and let parallel scoring determine the best one.
 *
 * @param baseCreature The original creature before any changes
 * @param discoveryID The discovery session identifier
 * @param successfulCandidates Candidates that improved score in Phase 1
 * @returns Combined candidates to evaluate in Phase 2
 */
export function buildCombinedFromSuccessful(
  baseCreature: Creature,
  _discoveryID: string,
  successfulCandidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  if (successfulCandidates.length < 2) {
    return [];
  }

  const combinedCandidates: DiscoveryCandidate[] = [];
  // Track unique combinations to avoid duplicates
  const seenCombinations = new Set<string>();

  // Helper to create a combination key from candidate indices
  const makeCombinationKey = (indices: number[]): string =>
    [...indices].sort((a, b) => a - b).join(",");

  // Helper to build a combined creature from a subset of candidates
  const buildCombination = (
    candidates: DiscoveryCandidate[],
  ): DiscoveryCandidate | undefined => {
    let combinedCreature = baseCreature;
    let appliedCount = 0;
    const appliedTypes: string[] = [];

    for (const candidate of candidates) {
      const applied = applyChangeToCreature(
        combinedCreature,
        candidate,
        baseCreature,
      );
      if (applied && applied !== combinedCreature) {
        combinedCreature = applied;
        appliedCount++;
        if (!appliedTypes.includes(candidate.change.type)) {
          appliedTypes.push(candidate.change.type);
        }
      }
    }

    if (appliedCount >= 2 && combinedCreature !== baseCreature) {
      // Check if this is a removal-only combination
      const isRemovalOnly = appliedTypes.every((t) =>
        t === "remove-low-impact" || t === "remove-neuron" ||
        t === "remove-synapse"
      );
      const description = buildCombinationDescription(
        appliedTypes,
        appliedCount,
        isRemovalOnly,
      );
      return {
        creature: combinedCreature,
        change: {
          type: "combo-successful",
          description,
        },
      };
    }
    return undefined;
  };

  // Strategy 1: All successful candidates combined
  const allKey = makeCombinationKey(
    successfulCandidates.map((_, i) => i),
  );
  seenCombinations.add(allKey);
  const allCombined = buildCombination(successfulCandidates);
  if (allCombined) {
    combinedCandidates.push(allCombined);
  }

  // Strategy 2: All removal candidates combined (if there are multiple)
  // This is a key combination for cleaning up low-impact neurons
  const removalCandidates = successfulCandidates.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron" ||
      c.change.type === "remove-synapse",
  );
  if (removalCandidates.length >= 2) {
    const removalIndices = removalCandidates.map((c) =>
      successfulCandidates.indexOf(c)
    );
    const removalKey = makeCombinationKey(removalIndices);
    if (!seenCombinations.has(removalKey)) {
      seenCombinations.add(removalKey);
      const removalCombined = buildCombination(removalCandidates);
      if (removalCombined) {
        combinedCandidates.push(removalCombined);
      }
    }
  }

  // Strategy 3: All non-removal candidates combined (if there are multiple)
  const nonRemovalCandidates = successfulCandidates.filter(
    (c) =>
      c.change.type !== "remove-low-impact" &&
      c.change.type !== "remove-neuron" &&
      c.change.type !== "remove-synapse",
  );
  if (nonRemovalCandidates.length >= 2) {
    const nonRemovalIndices = nonRemovalCandidates.map((c) =>
      successfulCandidates.indexOf(c)
    );
    const nonRemovalKey = makeCombinationKey(nonRemovalIndices);
    if (!seenCombinations.has(nonRemovalKey)) {
      seenCombinations.add(nonRemovalKey);
      const nonRemovalCombined = buildCombination(nonRemovalCandidates);
      if (nonRemovalCombined) {
        combinedCandidates.push(nonRemovalCombined);
      }
    }
  }

  // Strategy 4: Pairwise combinations
  // Try all pairs to find which 2 changes work best together
  if (successfulCandidates.length >= 2 && successfulCandidates.length <= 10) {
    for (let i = 0; i < successfulCandidates.length; i++) {
      for (let j = i + 1; j < successfulCandidates.length; j++) {
        const pairKey = makeCombinationKey([i, j]);
        if (seenCombinations.has(pairKey)) continue;
        seenCombinations.add(pairKey);

        const candidateA = successfulCandidates[i];
        const candidateB = successfulCandidates[j];

        const pairCombined = buildCombination([candidateA, candidateB]);
        if (pairCombined) {
          combinedCandidates.push(pairCombined);
        }
      }
    }
  }

  // Strategy 5: Triple combinations (for medium-sized candidate sets)
  // Try all triples to find optimal 3-way combinations
  if (successfulCandidates.length >= 4 && successfulCandidates.length <= 8) {
    for (let i = 0; i < successfulCandidates.length; i++) {
      for (let j = i + 1; j < successfulCandidates.length; j++) {
        for (let k = j + 1; k < successfulCandidates.length; k++) {
          const tripleKey = makeCombinationKey([i, j, k]);
          if (seenCombinations.has(tripleKey)) continue;
          seenCombinations.add(tripleKey);

          const tripleCandidates = [
            successfulCandidates[i],
            successfulCandidates[j],
            successfulCandidates[k],
          ];

          const tripleCombined = buildCombination(tripleCandidates);
          if (tripleCombined) {
            combinedCandidates.push(tripleCombined);
          }
        }
      }
    }
  }

  // Log summary of generated combinations
  if (combinedCandidates.length > 0) {
    console.info(
      `[DiscoveryCandidates] Generated ${combinedCandidates.length} combination candidate${
        combinedCandidates.length === 1 ? "" : "s"
      } from ${successfulCandidates.length} successful singles`,
    );
  }

  return combinedCandidates;
}

/**
 * Safely validates a creature and handles validation errors.
 *
 * Strategy:
 * 1. Always call validate() first - this is the preferred path (no structural issues)
 * 2. If validate() fails, log details
 * 3. Only call fix() as a last resort - each fix() call indicates a bug that should be addressed
 *
 * The goal is to reuse battle-hardened logic from src/mutate classes (DRY principle) to avoid
 * creating broken creatures in the first place. If we're calling fix(), it means our modification
 * logic needs improvement.
 *
 * Note: This is a synchronous function for use in synchronous contexts. If async debug file
 * writing is needed in the future, an async version can be added.
 *
 * @param creature The creature to validate
 * @param changeType The type of change being applied (for logging)
 * @returns The validated (and potentially fixed) creature
 */
function validateAndFixCreatureSync(
  creature: Creature,
  changeType: DiscoveryChangeType,
): Creature {
  const enforceForwardOnly = shouldEnforceForwardOnly(creature);
  try {
    // Preferred path: validate first - if this passes, no fix() needed
    if (enforceForwardOnly) {
      creature.validate({ forwardOnly: true });
      creature.forwardOnly = true;
    } else {
      creature.validate();
    }
    return creature;
  } catch (error) {
    // Validation failed - this indicates our modification logic created an invalid creature
    const validationError = error instanceof ValidationError
      ? error
      : new ValidationError(
        `Unexpected error during validation: ${error}`,
        "OTHER",
      );

    // Log the validation failure with details
    console.warn(
      `[DiscoveryCandidates] Validation failed for ${changeType} change: ${validationError.message}`,
    );
    console.warn(
      `[DiscoveryCandidates] Cannot write debug file in synchronous context`,
    );

    // Last resort: call fix() to repair the creature
    // This should be treated as a bug - the modification logic should be improved
    console.warn(
      `[DiscoveryCandidates] Calling fix() on ${changeType} change - this indicates a bug in modification logic that should be addressed`,
    );
    if (enforceForwardOnly) {
      creature.fix({ forwardOnly: true });
      creature.forwardOnly = true;
    } else {
      creature.fix();
    }

    // Validate again after fix() to ensure it's now valid
    try {
      if (enforceForwardOnly) {
        creature.validate({ forwardOnly: true });
        creature.forwardOnly = true;
      } else {
        creature.validate();
      }
    } catch (fixError) {
      console.error(
        `[DiscoveryCandidates] Creature still invalid after fix() for ${changeType}: ${fixError}`,
      );
      throw fixError;
    }

    return creature;
  }
}

/**
 * Apply a candidate's change to a creature, returning the modified creature.
 *
 * @param creature The creature to apply the change to (may have prior modifications)
 * @param candidate The candidate containing the change to apply
 * @param baseCreature The original creature before any changes (used for removal detection)
 */
function applyChangeToCreature(
  creature: Creature,
  candidate: DiscoveryCandidate,
  baseCreature: Creature,
): Creature | undefined {
  const changeType = candidate.change.type;
  const candidateJSON = candidate.creature.exportJSON();
  const creatureJSON = creature.exportJSON();
  const baseJSON = baseCreature.exportJSON();
  const enforceForwardOnly = shouldEnforceForwardOnly(creature);
  const uuidToIndex = enforceForwardOnly
    ? buildUuidToIndexMap(creatureJSON)
    : undefined;

  try {
    switch (changeType) {
      case "add-synapses": {
        // Find synapses in candidate that don't exist in creature
        const existingSynapses = new Set(
          creatureJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );
        // Build set of existing neuron UUIDs to validate synapse endpoints
        // Include input neurons (not in neurons array but referenced as input-N)
        const existingNeurons = new Set(
          creatureJSON.neurons.map((n) => n.uuid),
        );
        const inputCount = creatureJSON.input ?? 0;
        for (let i = 0; i < inputCount; i++) {
          existingNeurons.add(`input-${i}`);
        }
        // Only add synapses where BOTH endpoints exist in current creature
        // (handles combinations where neurons were removed by prior steps)
        const newSynapses = candidateJSON.synapses.filter(
          (s) =>
            !existingSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            existingNeurons.has(s.fromUUID) &&
            existingNeurons.has(s.toUUID) &&
            (!enforceForwardOnly ||
              (() => {
                const from = uuidToIndex?.get(s.fromUUID);
                const to = uuidToIndex?.get(s.toUUID);
                // Forward-only: reject self-loops and back connections.
                return from !== undefined && to !== undefined && from < to;
              })()),
        );
        if (newSynapses.length === 0) return creature;

        creatureJSON.synapses.push(...newSynapses);
        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        validateAndFixCreatureSync(result, "add-synapses");
        CreatureUtil.makeUUID(result);
        return result;
      }

      case "add-neurons": {
        // Find neurons in candidate that don't exist in creature
        const existingNeurons = new Set(
          creatureJSON.neurons.map((n) => n.uuid),
        );
        const candidateNeurons = candidateJSON.neurons.filter(
          (n) => n.type === "hidden" && !existingNeurons.has(n.uuid),
        );
        if (candidateNeurons.length === 0) return creature;

        // Insert new neurons in a forward-pass-safe position based on the *candidate*
        // neurone ordering (not by guessing from a single outgoing synapse).
        //
        // Why: a new neuron may target another new neuron (new -> new), or it may
        // have multiple outgoing targets. In those cases, inserting each neuron by
        // looking up only one outgoing target in the current creature can create a
        // backward edge (fromIndex > toIndex), breaking forward-pass ordering.
        //
        // Strategy: keep the existing neurone list intact and splice in the newly
        // added neurons as ordered blocks before their next non-new "anchor" neurone
        // in the candidate list. This preserves the candidate creature's ordering
        // constraints while also retaining any neurons introduced by earlier steps
        // in a combination.
        const newNeuronUUIDs = new Set(candidateNeurons.map((n) => n.uuid));
        const candidateNewNeuronMap = new Map(
          candidateNeurons.map((n) => [n.uuid, n] as const),
        );
        const END_ANCHOR = "__END__";

        const anchorToNewNeurons = new Map<string, typeof candidateNeurons>();
        const candidateUUIDs = candidateJSON.neurons.map((n) => n.uuid);
        for (let i = 0; i < candidateUUIDs.length; i++) {
          const uuid = candidateUUIDs[i];
          if (!newNeuronUUIDs.has(uuid)) continue;

          let anchorUUID: string | undefined;
          for (let j = i + 1; j < candidateUUIDs.length; j++) {
            const nextUUID = candidateUUIDs[j];
            if (!newNeuronUUIDs.has(nextUUID)) {
              anchorUUID = nextUUID;
              break;
            }
          }

          const key = anchorUUID ?? END_ANCHOR;
          const neuron = candidateNewNeuronMap.get(uuid);
          if (!neuron) continue;
          const list = anchorToNewNeurons.get(key) ?? [];
          list.push(neuron);
          anchorToNewNeurons.set(key, list);
        }

        const inserted = new Set<string>();
        const mergedNeurons: typeof creatureJSON.neurons = [];
        for (const neuron of creatureJSON.neurons) {
          const toInsert = anchorToNewNeurons.get(neuron.uuid);
          if (toInsert && toInsert.length > 0) {
            for (const newNeuron of toInsert) {
              if (inserted.has(newNeuron.uuid)) continue;
              mergedNeurons.push(newNeuron);
              inserted.add(newNeuron.uuid);
            }
          }
          mergedNeurons.push(neuron);
        }

        // Any remaining new neurons (eg, anchor was removed by a prior combo step)
        // are inserted before the first output to keep outputs contiguous.
        const remaining = candidateNeurons.filter((n) => !inserted.has(n.uuid));
        if (remaining.length > 0) {
          const firstOutputIndex = mergedNeurons.findIndex((n) =>
            n.type === "output"
          );
          const insertAt = firstOutputIndex >= 0
            ? firstOutputIndex
            : mergedNeurons.length;
          mergedNeurons.splice(insertAt, 0, ...remaining);
          for (const neuron of remaining) inserted.add(neuron.uuid);
        }

        creatureJSON.neurons = mergedNeurons;

        // Update existing neurons set to include newly added neurons and input neurons
        const updatedNeurons = new Set(
          creatureJSON.neurons.map((n) => n.uuid),
        );
        const inputCount = creatureJSON.input ?? 0;
        for (let i = 0; i < inputCount; i++) {
          updatedNeurons.add(`input-${i}`);
        }

        // Find synapses connected to these new neurons
        // Only include synapses where BOTH endpoints exist in current creature
        const newSynapses = candidateJSON.synapses.filter(
          (s) =>
            (newNeuronUUIDs.has(s.fromUUID) || newNeuronUUIDs.has(s.toUUID)) &&
            updatedNeurons.has(s.fromUUID) &&
            updatedNeurons.has(s.toUUID),
        );
        creatureJSON.synapses.push(...newSynapses);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        validateAndFixCreatureSync(result, "add-neurons");
        CreatureUtil.makeUUID(result);
        return result;
      }

      case "change-squash": {
        // Copy squash changes from candidate
        const candidateNeuronMap = new Map(
          candidateJSON.neurons.map((n) => [n.uuid, n]),
        );
        let changed = false;
        for (const neuron of creatureJSON.neurons) {
          const candidateNeuron = candidateNeuronMap.get(neuron.uuid);
          if (candidateNeuron && candidateNeuron.squash !== neuron.squash) {
            neuron.squash = candidateNeuron.squash;
            changed = true;
          }
        }
        if (!changed) return creature;

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        validateAndFixCreatureSync(result, "change-squash");
        CreatureUtil.makeUUID(result);
        return result;
      }

      case "remove-synapse": {
        // Find synapses that were in base but removed in candidate
        // This ensures we only remove what the candidate intended to remove,
        // not synapses added by previous operations in the combination
        const baseSynapses = new Set(
          baseJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );
        const candidateSynapses = new Set(
          candidateJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );
        const creatureSynapses = new Set(
          creatureJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );

        // Synapses to remove: existed in base but not in candidate
        const toRemove = new Set(
          [...baseSynapses].filter((key) => !candidateSynapses.has(key)),
        );

        // Also add reconnection synapses: new in candidate but not in creature
        // These maintain connectivity after removal
        const toAdd = candidateJSON.synapses.filter(
          (s) =>
            !baseSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            !creatureSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            (!enforceForwardOnly ||
              (() => {
                const from = uuidToIndex?.get(s.fromUUID);
                const to = uuidToIndex?.get(s.toUUID);
                return from !== undefined && to !== undefined && from < to;
              })()),
        );

        if (toRemove.size === 0 && toAdd.length === 0) return creature;

        creatureJSON.synapses = creatureJSON.synapses.filter(
          (s) => !toRemove.has(`${s.fromUUID}->${s.toUUID}`),
        );

        // Clean up memetic data for removed synapses
        for (const synapseKey of toRemove) {
          const [fromUUID, toUUID] = synapseKey.split("->");
          cleanupMemeticForRemovedSynapse(creatureJSON, fromUUID, toUUID);
        }

        creatureJSON.synapses.push(...toAdd);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        validateAndFixCreatureSync(result, "remove-synapse");
        CreatureUtil.makeUUID(result);
        return result;
      }

      case "remove-neuron":
      case "remove-low-impact": {
        // Find neurons that were in base but removed in candidate
        // This ensures we only remove what the candidate intended to remove,
        // not neurons added by previous operations in the combination
        const baseNeurons = new Set(
          baseJSON.neurons.filter((n) => n.type === "hidden").map((n) =>
            n.uuid
          ),
        );
        const candidateNeurons = new Set(
          candidateJSON.neurons.map((n) => n.uuid),
        );
        const baseSynapses = new Set(
          baseJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );
        const creatureSynapses = new Set(
          creatureJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );

        // Neurons to remove: existed in base (as hidden) but not in candidate
        const toRemove = new Set(
          [...baseNeurons].filter((uuid) => !candidateNeurons.has(uuid)),
        );

        // First, apply the removals
        creatureJSON.neurons = creatureJSON.neurons.filter(
          (n) => !toRemove.has(n.uuid),
        );
        creatureJSON.synapses = creatureJSON.synapses.filter(
          (s) => !toRemove.has(s.fromUUID) && !toRemove.has(s.toUUID),
        );

        // Clean up memetic data for removed neurons
        for (const neuronUUID of toRemove) {
          cleanupMemeticForRemovedNeuron(creatureJSON, neuronUUID);
        }

        // Build set of remaining neuron UUIDs for synapse validation
        // Include input neurons (not in neurons array but referenced as input-N)
        const remainingNeurons = new Set(
          creatureJSON.neurons.map((n) => n.uuid),
        );
        const inputCount = creatureJSON.input ?? 0;
        for (let i = 0; i < inputCount; i++) {
          remainingNeurons.add(`input-${i}`);
        }

        const uuidToIndexAfterRemovals = enforceForwardOnly
          ? buildUuidToIndexMap(creatureJSON)
          : undefined;

        // Add reconnection synapses: new in candidate but not in creature
        // These maintain connectivity after neuron removal
        // IMPORTANT: Only add synapses where BOTH endpoints exist in the current creature
        // (handles sequential removals where later candidates may reference already-removed neurons)
        const toAdd = candidateJSON.synapses.filter(
          (s) =>
            !baseSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            !creatureSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            remainingNeurons.has(s.fromUUID) &&
            remainingNeurons.has(s.toUUID) &&
            (!enforceForwardOnly ||
              (() => {
                const from = uuidToIndexAfterRemovals?.get(s.fromUUID);
                const to = uuidToIndexAfterRemovals?.get(s.toUUID);
                return from !== undefined && to !== undefined && from < to;
              })()),
        );

        if (toRemove.size === 0 && toAdd.length === 0) return creature;

        creatureJSON.synapses.push(...toAdd);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        validateAndFixCreatureSync(result, changeType);
        CreatureUtil.makeUUID(result);
        return result;
      }

      default:
        // For combo types or unknown, just return the candidate's creature
        // This shouldn't happen in two-phase scoring but provides a fallback
        console.warn(
          `[DiscoveryCandidates] Unknown change type for combination: ${changeType}`,
        );
        return undefined;
    }
  } catch (error) {
    console.warn(
      `[DiscoveryCandidates] Failed to apply ${changeType} change during combination:`,
      error,
    );
    return undefined;
  }
}

/**
 * Emoji legend for discovery candidates (unique emoji per category):
 *
 * **Single Candidates:**
 * - 💡 Add neuron(s)
 * - 🔗 Add synapse(s)
 * - 🎨 Change activation function
 * - 🪶 Remove low-impact neuron
 * - 💀 Remove harmful neuron
 * - ✂️ Remove harmful synapse
 *
 * **Combination Candidates:**
 * - ✂️ Pruning only (multiple removals)
 * - 🌱 Growth only (add neurons + synapses)
 * - 🧬 Structural changes only (add without removal)
 * - 🦋 Metamorphosis (removal + addition)
 * - ⚡ Optimisation (change squash + other)
 * - 🏆 Multi-category combination (3+ types)
 */

/**
 * Select an appropriate emoji for the combination based on change types.
 * Each combination category has a unique emoji to distinguish at a glance.
 */
function selectCombinationEmoji(types: string[]): string {
  const typeSet = new Set(types);
  const hasRemoval = typeSet.has("remove-low-impact") ||
    typeSet.has("remove-neuron") ||
    typeSet.has("remove-synapse");
  const hasAddition = typeSet.has("add-neurons") || typeSet.has("add-synapses");
  const hasSquashChange = typeSet.has("change-squash");

  // Multi-category combinations (3+ distinct types)
  if (typeSet.size >= 3) {
    return "🏆"; // Achievement - comprehensive improvement
  }

  // Metamorphosis: removal + addition (structural transformation)
  if (hasRemoval && hasAddition) {
    return "🦋"; // Metamorphosis - shedding old, gaining new
  }

  // Optimisation: squash change + other changes
  if (hasSquashChange && (hasRemoval || hasAddition)) {
    return "⚡"; // Optimisation - performance tuning
  }

  // Pure removal combinations (pruning)
  if (hasRemoval && !hasAddition && !hasSquashChange) {
    return "✂️"; // Pruning - trimming excess
  }

  // Pure addition combinations (growth)
  if (hasAddition && !hasRemoval && !hasSquashChange) {
    if (typeSet.has("add-neurons") && typeSet.has("add-synapses")) {
      return "🌱"; // Growing - adding neurons and connections
    }
    return "🧬"; // Structural - adding structure
  }

  // Squash-only combinations
  if (hasSquashChange && !hasRemoval && !hasAddition) {
    return "🎭"; // Transformation - changing behaviour
  }

  return "🔬"; // Generic scientific discovery
}

/**
 * Build a human-readable description for a combination of changes.
 * Uses proper grammar suitable for git commit messages.
 *
 * @param appliedTypes The types of changes that were applied
 * @param appliedCount The number of changes applied
 * @param isRemovalOnly Whether all changes are removal operations
 */
function buildCombinationDescription(
  appliedTypes: string[],
  appliedCount: number,
  isRemovalOnly: boolean,
): string {
  const emoji = selectCombinationEmoji(appliedTypes);

  // Single type combinations - use specific descriptions
  // IMPORTANT: Check this BEFORE isRemovalOnly to handle remove-synapse correctly
  if (appliedTypes.length === 1) {
    const type = appliedTypes[0];
    switch (type) {
      case "add-neurons":
        return `${emoji} Added ${appliedCount} neurons`;
      case "add-synapses":
        return `${emoji} Added ${appliedCount} synapses`;
      case "change-squash":
        return `${emoji} Changed ${appliedCount} activation functions`;
      case "remove-low-impact":
      case "remove-neuron":
        return `${emoji} Pruned ${appliedCount} low-impact neurons`;
      case "remove-synapse":
        return `${emoji} Removed ${appliedCount} synapses`;
      default:
        return `${emoji} Applied ${appliedCount} ${type} changes`;
    }
  }

  // Multi-type pure removal combinations (neuron removals) - use "Pruned" verb
  // Note: This is for combinations of remove-low-impact, remove-neuron types
  // but NOT for pure remove-synapse combinations (handled above as single-type)
  if (isRemovalOnly) {
    // Check if this is synapse-only removal combination
    const isSynapseOnly = appliedTypes.every((t) => t === "remove-synapse");
    if (isSynapseOnly) {
      return `${emoji} Removed ${appliedCount} synapses`;
    }
    // Mixed removal types or neuron-only removals
    return `${emoji} Pruned ${appliedCount} low-impact neurons`;
  }

  // Multi-type combinations - describe the overall effect
  const hasRemoval = appliedTypes.some((t) =>
    t.includes("remove") || t === "remove-low-impact"
  );
  const hasAddition = appliedTypes.some((t) =>
    t === "add-neurons" || t === "add-synapses"
  );
  const hasSquash = appliedTypes.includes("change-squash");

  if (hasRemoval && hasAddition) {
    return `${emoji} Restructured network: pruned and expanded`;
  }
  if (hasSquash && (hasRemoval || hasAddition)) {
    return `${emoji} Optimised network structure and activations`;
  }
  if (hasAddition) {
    return `${emoji} Expanded network with new structure`;
  }

  return `${emoji} Applied ${appliedCount} structural improvements`;
}
