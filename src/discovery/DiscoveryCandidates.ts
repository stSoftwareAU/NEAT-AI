import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import {
  type CandidateHarmfulNeuron,
  type CandidateNeuron,
  type CandidateSquash,
  type CandidateSynapse,
  DiscoverStructure,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import { CreatureErrorImpactEstimator } from "./NeuronErrorImpactEstimator.ts";

const EPSILON = 1e-9;

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
  // Ensure the base creature has a UUID so discovery helpers function correctly.
  CreatureUtil.makeUUID(baseCreature);
  const impactEstimator = new CreatureErrorImpactEstimator(baseCreature);

  const scaledNeuronExpected = (candidate: CandidateNeuron) => {
    const share = impactEstimator.getNeuronShare(candidate.toNeuronUUID);
    // If we have recorded stats, use the actual error magnitude to scale more accurately
    if (candidate.targetNeuronStats) {
      const stats = candidate.targetNeuronStats;
      // Use mean error magnitude to estimate the actual error contribution
      // The neuron-level improvement percentage is relative to the neuron's error
      // We scale it by the share and the relative error magnitude
      const neuronErrorMagnitude = Math.abs(stats.meanError) +
        Math.sqrt(stats.errorVariance);
      const creatureTotalErrorStr = getTag(baseCreature, "error");
      if (creatureTotalErrorStr) {
        const creatureTotalError = Number.parseFloat(creatureTotalErrorStr);
        if (creatureTotalError > EPSILON && neuronErrorMagnitude > EPSILON) {
          // Scale by: (neuron error / creature error) * share
          const errorRatio = neuronErrorMagnitude / creatureTotalError;
          return scaleExpectedImprovement(
            candidate.expectedImprovementPercentage,
            share * Math.min(1.0, errorRatio),
          );
        }
      }
    }
    return scaleExpectedImprovement(
      candidate.expectedImprovementPercentage,
      share,
    );
  };
  const scaledSynapseExpected = (candidate: CandidateSynapse) => {
    const share = impactEstimator.getNeuronShare(candidate.toNeuronUUID);
    // If we have recorded stats, use the actual error magnitude to scale more accurately
    if (candidate.targetNeuronStats) {
      const stats = candidate.targetNeuronStats;
      const neuronErrorMagnitude = Math.abs(stats.meanError) +
        Math.sqrt(stats.errorVariance);
      const creatureTotalErrorStr = getTag(baseCreature, "error");
      if (creatureTotalErrorStr) {
        const creatureTotalError = Number.parseFloat(creatureTotalErrorStr);
        if (creatureTotalError > EPSILON && neuronErrorMagnitude > EPSILON) {
          const errorRatio = neuronErrorMagnitude / creatureTotalError;
          return scaleExpectedImprovement(
            candidate.expectedImprovementPercentage,
            share * Math.min(1.0, errorRatio),
          );
        }
      }
    }
    return scaleExpectedImprovement(
      candidate.expectedImprovementPercentage,
      share,
    );
  };
  const scaledSquashExpected = (candidate: CandidateSquash) =>
    scaleExpectedImprovement(
      candidate.expectedImprovementPercentage,
      impactEstimator.getNeuronShare(candidate.neuronUUID),
    );
  const scaledRemovalExpected = (candidate?: CandidateSynapse) => {
    if (!candidate) return undefined;
    const scaled = scaledSynapseExpected(candidate);
    return scaled !== undefined ? Math.abs(scaled) : undefined;
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
    )
    : undefined;
  if (addedNeuronCreature && helpfulNeuronCandidates) {
    const neuronSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        helpfulNeuronCandidates,
        scaledNeuronExpected,
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
      scaledNeuronExpected,
    ),
  );

  const addedSynapseCreature = DiscoverStructure.addHelpfulSynapses(
    discovery.ID,
    baseCreature,
    addHelpfulSynapses,
  );
  if (addedSynapseCreature) {
    const synapseSummary = summariseExpectedImprovement(
      mapScaledSummaryEntries(
        addHelpfulSynapses,
        scaledSynapseExpected,
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
      scaledSynapseExpected,
    ),
  );

  const removedSynapseCreature = DiscoverStructure.removeSynapse(
    discovery.ID,
    baseCreature,
    removeHarmfulSynapse,
  );
  if (removedSynapseCreature && removeHarmfulSynapse) {
    candidates.push({
      creature: removedSynapseCreature,
      change: {
        type: "remove-synapse",
        description: `✂️ Removed harmful synapse ${
          shortID(removeHarmfulSynapse.fromNeuronUUID)
        } -> ${shortID(removeHarmfulSynapse.toNeuronUUID)}`,
        expectedErrorReduction: scaledRemovalExpected(removeHarmfulSynapse),
        sampleSize: removeHarmfulSynapse.totalCount,
        synapseDetails: {
          fromNeuronUUID: removeHarmfulSynapse.fromNeuronUUID,
          toNeuronUUID: removeHarmfulSynapse.toNeuronUUID,
        },
      },
    });

    // Only build combined candidates if not skipped (for two-phase scoring)
    if (!skipCombos && addedSynapseCreature && removeHarmfulSynapse) {
      let combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        removedSynapseCreature,
        addHelpfulSynapses,
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
            const updated = Creature.fromJSON(exportJSON);
            // We modified the structure by filtering synapses, so we must delete UUID
            delete updated.uuid;
            updated.fix();

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
  );
  if (changedSquashCreature) {
    const changes = (candidateSquashes || []).map((c) => {
      const neuron = baseCreature.neurons.find((n) => n.uuid === c.neuronUUID);
      const oldSquash = neuron?.squash;
      const improvementValue = scaledSquashExpected(c);
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
      mapScaledSummaryEntries(candidateSquashes, scaledSquashExpected),
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
      scaledSquashExpected,
    ),
  );

  const removedNeuronCreature = removeHarmfulNeurons &&
      removeHarmfulNeurons.length > 0
    ? DiscoverStructure.removeHarmfulNeuron(
      discovery.ID,
      baseCreature,
      removeHarmfulNeurons[0],
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
        expectedErrorReduction: mostHarmful.expectedImprovementPercentage,
        sampleSize: mostHarmful.sampleCount,
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
  // Track successfully removed candidates for combined removal
  const successfulRemovals: typeof removalCandidates = [];

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
      );
      if (removedLowImpactCreature) {
        removalSuccessCount++;
        successfulRemovals.push(candidate);
        candidates.push({
          creature: removedLowImpactCreature,
          change: {
            type: "remove-low-impact",
            description: `🪶 Removed neuron ${
              shortID(candidate.neuronUUID)
            } (impact: ${candidate.impact.toExponential(2)})`,
            // No expectedErrorReduction - removal improves score via complexity reduction, not error
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

    // Build a COMBINED removal candidate that removes ALL successful candidates at once
    // This allows cleaning up multiple low-impact neurons in a single operation
    // The combined version competes with individual removals - best score wins
    if (successfulRemovals.length >= 2) {
      let combinedRemovalCreature: Creature | undefined = baseCreature;

      // Apply each removal sequentially to the same creature
      for (const candidate of successfulRemovals) {
        if (!combinedRemovalCreature) break;

        combinedRemovalCreature = DiscoverStructure.removeLowImpactNeuron(
          discovery.ID,
          combinedRemovalCreature,
          candidate,
        );
      }

      if (combinedRemovalCreature && combinedRemovalCreature !== baseCreature) {
        // Format neuron IDs for git log message
        const neuronIDs = successfulRemovals
          .map((c) => shortID(c.neuronUUID))
          .join(", ");

        // Git-friendly message: clear, concise, good English
        const description = successfulRemovals.length === 2
          ? `🧹 Pruned 2 low-impact neurons in combined cleanup (${neuronIDs})`
          : `🧹 Pruned ${successfulRemovals.length} low-impact neurons in combined cleanup`;

        candidates.push({
          creature: combinedRemovalCreature,
          change: {
            type: "remove-low-impact",
            description,
            // No expectedErrorReduction - removal improves score via complexity reduction, not error
          },
        });

        // Detailed logging for diagnostics (not in git)
        const impactDetails = successfulRemovals
          .map((c) => `${shortID(c.neuronUUID)}:${c.impact.toExponential(2)}`)
          .join(", ");
        console.info(
          `[DiscoveryCandidates] Created combined removal candidate: ${successfulRemovals.length} neurons [${impactDetails}]`,
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
    });
    if (combinedCandidate) {
      candidates.push(combinedCandidate);
    }

    const bestOfCategoryCandidate = buildBestOfCategoryCandidate(
      baseCreature,
      discovery,
      {
        synapse: scaledSynapseExpected,
        neuron: scaledNeuronExpected,
        squash: scaledSquashExpected,
      },
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
            const updated = Creature.fromJSON(exportJSON);
            // We modified the structure by filtering synapses, so we must delete UUID
            delete updated.uuid;
            updated.fix();

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
): DiscoveryCandidate[] {
  if (!synapses || synapses.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const synapse of synapses) {
    const creature = DiscoverStructure.addHelpfulSynapses(
      discoveryID,
      baseCreature,
      [synapse],
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
): DiscoveryCandidate[] {
  if (!squashes || squashes.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  let skippedCount = 0;
  for (const squash of squashes) {
    const creature = DiscoverStructure.changeSquash(
      discoveryID,
      baseCreature,
      [squash],
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
  T extends { expectedImprovementPercentage: number; totalCount?: number },
>(
  entries?: readonly T[],
): { average?: number; sampleSize?: number } {
  if (!entries || entries.length === 0) return {};
  let weightedTotal = 0;
  let weightSum = 0;
  let sampleSize = 0;

  for (const entry of entries) {
    const value = entry.expectedImprovementPercentage;
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
): Array<{ expectedImprovementPercentage: number; totalCount?: number }> {
  if (!entries || entries.length === 0) return [];
  const mapped: Array<
    { expectedImprovementPercentage: number; totalCount?: number }
  > = [];
  for (const entry of entries) {
    const scaled = scale(entry);
    if (scaled === undefined || Number.isFinite(scaled) === false) {
      continue;
    }
    mapped.push({
      expectedImprovementPercentage: scaled,
      totalCount: countSelector ? countSelector(entry) : undefined,
    });
  }
  return mapped;
}

function scaleExpectedImprovement(
  raw?: number,
  share?: number,
): number | undefined {
  if (raw === undefined || Number.isFinite(raw) === false) {
    return undefined;
  }
  const safeShare = Number.isFinite(share)
    ? Math.min(Math.max(share ?? 0, 0), 1)
    : 0;
  return raw * safeShare;
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
}

interface ScalingFunctions {
  synapse: (synapse: CandidateSynapse) => number | undefined;
  neuron: (neuron: CandidateNeuron) => number | undefined;
  squash: (squash: CandidateSquash) => number | undefined;
}

function buildCombinedCandidate(
  args: CombinedCandidateArgs,
): DiscoveryCandidate | undefined {
  const { baseCreature, discoveryID, selection, changeType, description } =
    args;

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
        const updated = Creature.fromJSON(exportJSON);
        // We modified the structure by filtering synapses, so we must delete UUID
        delete updated.uuid;
        updated.fix();

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
  });
}

function wrapBestCandidate<
  T extends { expectedImprovementPercentage?: number },
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
      : currentBest.expectedImprovementPercentage ?? Number.NEGATIVE_INFINITY;
    const candidateScore = scoreSelector
      ? scoreSelector(candidate) ?? Number.NEGATIVE_INFINITY
      : candidate.expectedImprovementPercentage ?? Number.NEGATIVE_INFINITY;
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
 * Creates pairwise combinations and an all-successful combination.
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

  // Group successful candidates by their change type for targeted combination
  const byType = new Map<string, DiscoveryCandidate[]>();
  for (const candidate of successfulCandidates) {
    const type = candidate.change.type;
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(candidate);
  }

  // Build all-successful combination by applying changes sequentially
  let combinedCreature = baseCreature;
  const appliedTypes: string[] = [];
  const appliedDescriptions: string[] = [];

  // Apply changes in a deterministic order (sorted by type name)
  const sortedTypes = [...byType.keys()].sort();
  for (const type of sortedTypes) {
    const candidates = byType.get(type)!;
    // Use the first (or best) candidate of each type
    const best = candidates[0];

    // Try to apply this change to the combined creature
    const applied = applyChangeToCreature(
      combinedCreature,
      best,
      baseCreature,
    );

    if (applied && applied !== combinedCreature) {
      combinedCreature = applied;
      appliedTypes.push(type);
      const shortDesc = best.change.description?.split(" ")[0] || type;
      appliedDescriptions.push(shortDesc);
    }
  }

  if (appliedTypes.length >= 2 && combinedCreature !== baseCreature) {
    // Select emoji based on the combination
    const emoji = selectCombinationEmoji(appliedTypes);
    const description =
      `${emoji} Combined ${appliedTypes.length} successful changes: ${
        appliedTypes.join(", ")
      }`;

    combinedCandidates.push({
      creature: combinedCreature,
      change: {
        type: "combo-successful",
        description,
      },
    });
  }

  // If we have more than 2 successful candidates, also try pairwise combinations
  // to see if any pair performs better than the full combination
  if (successfulCandidates.length > 2 && successfulCandidates.length <= 6) {
    for (let i = 0; i < successfulCandidates.length; i++) {
      for (let j = i + 1; j < successfulCandidates.length; j++) {
        const candidateA = successfulCandidates[i];
        const candidateB = successfulCandidates[j];

        // Skip if same type (already handled above)
        if (candidateA.change.type === candidateB.change.type) continue;

        const afterA = applyChangeToCreature(
          baseCreature,
          candidateA,
          baseCreature,
        );
        if (afterA && afterA !== baseCreature) {
          const afterBoth = applyChangeToCreature(
            afterA,
            candidateB,
            baseCreature,
          );
          // Verify candidateB actually changed something (not just returned afterA unchanged)
          if (afterBoth && afterBoth !== afterA) {
            const emoji = selectCombinationEmoji([
              candidateA.change.type,
              candidateB.change.type,
            ]);
            combinedCandidates.push({
              creature: afterBoth,
              change: {
                type: "combo-successful",
                description:
                  `${emoji} Combined ${candidateA.change.type} + ${candidateB.change.type}`,
              },
            });
          }
        }
      }
    }
  }

  return combinedCandidates;
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

  try {
    switch (changeType) {
      case "add-synapses": {
        // Find synapses in candidate that don't exist in creature
        const existingSynapses = new Set(
          creatureJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
        );
        const newSynapses = candidateJSON.synapses.filter(
          (s) => !existingSynapses.has(`${s.fromUUID}->${s.toUUID}`),
        );
        if (newSynapses.length === 0) return creature;

        creatureJSON.synapses.push(...newSynapses);
        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        result.fix();
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

        // Find synapses connected to these new neurons
        const newNeuronUUIDs = new Set(candidateNeurons.map((n) => n.uuid));
        const newSynapses = candidateJSON.synapses.filter(
          (s) => newNeuronUUIDs.has(s.fromUUID) || newNeuronUUIDs.has(s.toUUID),
        );

        // Insert neurons before outputs
        const outputCount = creatureJSON.output ?? 1;
        const outputOffset = creatureJSON.neurons.length - outputCount;
        creatureJSON.neurons.splice(outputOffset, 0, ...candidateNeurons);
        creatureJSON.synapses.push(...newSynapses);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        result.fix();
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
        result.fix();
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
            !creatureSynapses.has(`${s.fromUUID}->${s.toUUID}`),
        );

        if (toRemove.size === 0 && toAdd.length === 0) return creature;

        creatureJSON.synapses = creatureJSON.synapses.filter(
          (s) => !toRemove.has(`${s.fromUUID}->${s.toUUID}`),
        );
        creatureJSON.synapses.push(...toAdd);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        result.fix();
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

        // Also add reconnection synapses: new in candidate but not in creature
        // These maintain connectivity after neuron removal
        const toAdd = candidateJSON.synapses.filter(
          (s) =>
            !baseSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
            !creatureSynapses.has(`${s.fromUUID}->${s.toUUID}`),
        );

        if (toRemove.size === 0 && toAdd.length === 0) return creature;

        creatureJSON.neurons = creatureJSON.neurons.filter(
          (n) => !toRemove.has(n.uuid),
        );
        creatureJSON.synapses = creatureJSON.synapses.filter(
          (s) => !toRemove.has(s.fromUUID) && !toRemove.has(s.toUUID),
        );
        creatureJSON.synapses.push(...toAdd);

        const result = Creature.fromJSON(creatureJSON);
        delete result.uuid;
        result.fix();
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
 * Select an appropriate emoji for the combination based on change types.
 */
function selectCombinationEmoji(types: string[]): string {
  const typeSet = new Set(types);

  // Fun, informative emoji selections based on what's being combined
  if (typeSet.has("remove-low-impact") && typeSet.has("add-neurons")) {
    return "🦋"; // Metamorphosis - shedding old, gaining new
  }
  if (typeSet.has("remove-low-impact") || typeSet.has("remove-neuron")) {
    return "✂️"; // Pruning/trimming
  }
  if (typeSet.has("add-neurons") && typeSet.has("add-synapses")) {
    return "🌱"; // Growing - adding structure
  }
  if (typeSet.has("change-squash")) {
    return "🎭"; // Transformation - changing behaviour
  }
  if (typeSet.has("add-neurons")) {
    return "🧠"; // Neural growth
  }
  if (typeSet.has("add-synapses")) {
    return "🔗"; // Connecting
  }
  if (types.length >= 3) {
    return "🏆"; // Triple or more combination - achievement!
  }
  return "🔬"; // Generic scientific discovery
}
