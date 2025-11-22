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
  | "change-squash"
  | "combo-add-remove"
  | "combo-add-change"
  | "combo-all"
  | "combo-best-of-category";

interface DiscoveryCandidateChange {
  type: DiscoveryChangeType;
  description?: string;
  expectedErrorReduction?: number;
  sampleSize?: number;
}

export interface DiscoveryCandidate {
  creature: Creature;
  change: DiscoveryCandidateChange;
}

/**
 * Build a list of possible improved creatures based on discovery suggestions.
 *
 * This function mirrors the logic that previously lived in `Neat.ts`, but the
 * resulting creatures are now returned for external evaluation instead of being
 * applied directly to the population.
 */
export function buildDiscoveryCandidates(
  baseCreature: Creature,
  discovery: DiscoverResult,
): DiscoveryCandidate[] {
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
  if (removedSynapseCreature) {
    candidates.push({
      creature: removedSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "✂️ Removed harmful synapse",
        expectedErrorReduction: scaledRemovalExpected(removeHarmfulSynapse),
        sampleSize: removeHarmfulSynapse?.totalCount,
      },
    });

    if (addedSynapseCreature) {
      const combinedAddRemove = DiscoverStructure.addHelpfulSynapses(
        discovery.ID,
        removedSynapseCreature,
        addHelpfulSynapses,
      );
      if (combinedAddRemove) {
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

    if (addedSynapseCreature) {
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
        description:
          `💀 Removed harmful neuron ${mostHarmful.neuronUUID} (error: ${
            mostHarmful.errorMagnitude.toExponential(2)
          })`,
        expectedErrorReduction: mostHarmful.expectedImprovementPercentage,
        sampleSize: mostHarmful.sampleCount,
      },
    });
  }

  const combinedCandidate = buildCombinedCandidate({
    baseCreature,
    discoveryID: discovery.ID,
    selection: {
      addHelpfulNeurons: addedNeuronCreature
        ? helpfulNeuronCandidates
        : undefined,
      addHelpfulSynapses: addedSynapseCreature ? addHelpfulSynapses : undefined,
      removeHarmfulSynapse: removedSynapseCreature
        ? removeHarmfulSynapse
        : undefined,
      removeHarmfulNeurons: removedNeuronCreature
        ? removeHarmfulNeurons
        : undefined,
      candidateSquashes: changedSquashCreature ? candidateSquashes : undefined,
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
  for (const synapse of synapses) {
    const creature = DiscoverStructure.addHelpfulSynapses(
      discoveryID,
      baseCreature,
      [synapse],
    );
    if (!creature) continue;
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
  return entries;
}

function buildSingleNeuronCandidates(
  discoveryID: string,
  baseCreature: Creature,
  neurons: CandidateNeuron[] | undefined,
  getExpected?: (neuron: CandidateNeuron) => number | undefined,
): DiscoveryCandidate[] {
  if (!neurons || neurons.length === 0) return [];
  const entries: DiscoveryCandidate[] = [];
  for (const neuron of neurons) {
    const creature = DiscoverStructure.addHelpfulNeurons(
      discoveryID,
      baseCreature,
      [neuron],
    );
    if (!creature) continue;
    entries.push({
      creature,
      change: {
        type: "add-neurons",
        description: `💡 Added neuron ${
          shortID(neuron.fromNeuronUUID)
        } -> ${neuron.squash} -> ${shortID(neuron.toNeuronUUID)}`,
        expectedErrorReduction: getExpected?.(neuron),
        sampleSize: neuron.totalCount,
      },
    });
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
  for (const squash of squashes) {
    const creature = DiscoverStructure.changeSquash(
      discoveryID,
      baseCreature,
      [squash],
    );
    if (!creature) continue;

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

function shortID(id: string): string {
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
