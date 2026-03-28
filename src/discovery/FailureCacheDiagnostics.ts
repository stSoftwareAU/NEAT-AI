/**
 * Failure Cache Diagnostics Module
 *
 * Functions for extracting diagnostic information from discovery candidates
 * and logging prediction traces for debugging prediction inversions.
 *
 * Extracted from FailureCache.ts as part of #1598.
 */

import type { Creature } from "../Creature.ts";
import { buildRuntimeIdToWireMap } from "../architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { getLogger } from "../utils/Logger.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type {
  ActualCreatureChange,
  ActualNeuronState,
  ActualSynapseState,
  FailureMetadata,
  PredictionDetails,
  TargetNeuronInfo,
} from "./FailureCacheTypes.ts";

/** Check if prediction tracing is enabled */
export function isPredictionTracingEnabled(): boolean {
  try {
    return Deno.env.get("NEAT_AI_TRACE_PREDICTION") === "1";
  } catch {
    return false;
  }
}

/**
 * Extracts the actual changes made to a creature by comparing with the base creature.
 * This allows verification that the TypeScript side correctly implemented what Rust requested.
 *
 * @param baseCreature - The original creature before changes
 * @param candidateCreature - The creature after changes were applied
 * @returns The actual changes made, or undefined if creatures are identical
 */
export function extractActualCreatureChanges(
  baseCreature: Creature,
  candidateCreature: Creature,
): ActualCreatureChange | undefined {
  const baseJSON = baseCreature.exportJSON();
  const candidateJSON = candidateCreature.exportJSON();
  const baseIdToWire = buildRuntimeIdToWireMap(baseCreature);
  const candidateIdToWire = buildRuntimeIdToWireMap(candidateCreature);

  // Build sets for comparison
  const baseNeuronIds = new Set(baseJSON.neurons.map((n) => n.id));
  const candidateNeuronIds = new Set(
    candidateJSON.neurons.map((n) => n.id),
  );

  const baseSynapseKeys = new Set(
    baseJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );
  const candidateSynapseKeys = new Set(
    candidateJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );

  // Find added neurons (in candidate but not in base)
  const addedNeurons: ActualNeuronState[] = [];
  for (const neuron of candidateJSON.neurons) {
    if (
      !baseNeuronIds.has(neuron.id) &&
      neuron.type === "hidden" &&
      neuron.squash // Skip neurons without squash (shouldn't happen for hidden)
    ) {
      const uuid = candidateIdToWire.get(neuron.id!);
      if (!uuid) continue;
      addedNeurons.push({
        uuid,
        squash: neuron.squash,
        bias: neuron.bias,
      });
    }
  }

  // Find added synapses (in candidate but not in base)
  const addedSynapses: ActualSynapseState[] = [];
  for (const synapse of candidateJSON.synapses) {
    const key = `${synapse.fromId}->${synapse.toId}`;
    if (!baseSynapseKeys.has(key)) {
      const fromUuid = candidateIdToWire.get(synapse.fromId!);
      const toUuid = candidateIdToWire.get(synapse.toId!);
      if (!fromUuid || !toUuid) continue;
      addedSynapses.push({
        fromUuid,
        toUuid,
        weight: synapse.weight,
      });
    }
  }

  // Find removed neurons (in base but not in candidate)
  const removedNeuronUuids: string[] = [];
  for (const neuron of baseJSON.neurons) {
    if (!candidateNeuronIds.has(neuron.id!) && neuron.type === "hidden") {
      const uuid = baseIdToWire.get(neuron.id!);
      if (uuid) {
        removedNeuronUuids.push(uuid);
      }
    }
  }

  // Find removed synapses (in base but not in candidate)
  const removedSynapseUuids: string[] = [];
  for (const synapse of baseJSON.synapses) {
    const key = `${synapse.fromId}->${synapse.toId}`;
    if (!candidateSynapseKeys.has(key)) {
      const fromUuid = baseIdToWire.get(synapse.fromId!);
      const toUuid = baseIdToWire.get(synapse.toId!);
      if (fromUuid && toUuid) {
        removedSynapseUuids.push(`${fromUuid}->${toUuid}`);
      }
    }
  }

  // Return undefined if nothing changed
  if (
    addedNeurons.length === 0 &&
    addedSynapses.length === 0 &&
    removedNeuronUuids.length === 0 &&
    removedSynapseUuids.length === 0
  ) {
    return undefined;
  }

  return {
    addedNeurons: addedNeurons.length > 0 ? addedNeurons : undefined,
    addedSynapses: addedSynapses.length > 0 ? addedSynapses : undefined,
    removedNeuronUuids: removedNeuronUuids.length > 0
      ? removedNeuronUuids
      : undefined,
    removedSynapseUuids: removedSynapseUuids.length > 0
      ? removedSynapseUuids
      : undefined,
  };
}

/**
 * Extracts prediction details from a discovery candidate for debugging.
 * This provides the Rust-side prediction data that can be compared against actual results.
 *
 * @param candidate - The discovery candidate to extract details from
 * @returns PredictionDetails if relevant data is available
 */
export function extractPredictionDetails(
  candidate: DiscoveryCandidate,
): PredictionDetails | undefined {
  const change = candidate.change;

  // For add-neurons candidates, extract from neuronDetails
  if (change.type === "add-neurons" && change.neuronDetails) {
    const details = change.neuronDetails;
    return {
      incomingWeight: details.incomingWeight,
      outgoingWeight: details.outgoingWeight,
      bias: details.bias,
      squash: details.squash,
    };
  }

  // For add-synapses candidates
  if (change.type === "add-synapses") {
    return {
      totalCount: change.sampleSize,
    };
  }

  return undefined;
}

/**
 * Extracts target neuron information from a candidate creature.
 *
 * @param candidate - The discovery candidate
 * @param baseCreature - The base creature before modifications
 * @returns TargetNeuronInfo if a target neuron can be identified
 */
export function extractTargetNeuronInfo(
  candidate: DiscoveryCandidate,
  baseCreature: Creature,
): TargetNeuronInfo | undefined {
  const change = candidate.change;
  const idToWire = buildRuntimeIdToWireMap(baseCreature);
  let targetUuid: string | undefined;

  // Identify target neuron based on change type
  if (change.type === "add-neurons" && change.neuronDetails) {
    targetUuid = change.neuronDetails.toNeuronUuid;
  } else if (change.type === "add-synapses") {
    targetUuid = change.synapseCandidate?.toNeuronUuid;
  }

  if (!targetUuid) return undefined;

  // Find the neuron in the base creature.
  const targetId = Array.from(idToWire.entries()).find(([, uuid]) =>
    uuid === targetUuid
  )?.[0];
  if (targetId === undefined) return undefined;
  const neuron = baseCreature.neurons.find((n) => n.id === targetId);
  if (!neuron) return undefined;

  const squashName = neuron.squash ?? "IDENTITY";

  return {
    uuid: targetUuid,
    squash: squashName,
    // Note: Saturation and stats would need runtime activation data
    // which we don't have access to in this context
  };
}

/**
 * Logs detailed prediction trace when NEAT_AI_TRACE_PREDICTION=1 is set.
 *
 * @param candidate - The candidate being traced
 * @param metadata - The failure metadata
 * @param cacheEntry - The cache entry being written
 */
export function logPredictionTrace(
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  // deno-lint-ignore no-explicit-any
  cacheEntry: Record<string, any>,
): void {
  if (!isPredictionTracingEnabled()) return;

  getLogger().info("=".repeat(80));
  getLogger().info("[PREDICTION TRACE] Candidate evaluation details");
  getLogger().info("=".repeat(80));
  getLogger().info(`Change Type: ${candidate.change.type}`);
  getLogger().info(`Description: ${candidate.change.description}`);
  getLogger().info("");

  // Log score comparison from metadata
  getLogger().info("--- Score Comparison ---");
  getLogger().info(
    `Original Score:    ${metadata.originalScore.toPrecision(8)}`,
  );
  getLogger().info(
    `Candidate Score:   ${metadata.candidateScore.toPrecision(8)}`,
  );
  getLogger().info(
    `Score Delta:       ${metadata.scoreDelta.toPrecision(8)} (${
      metadata.scoreDelta > 0 ? "IMPROVED" : "DEGRADED"
    })`,
  );
  getLogger().info("");

  // Log prediction details
  if (cacheEntry.predictionDetails) {
    getLogger().info("--- Rust Prediction Details ---");
    getLogger().info(JSON.stringify(cacheEntry.predictionDetails, null, 2));
    getLogger().info("");
  }

  // Log target neuron info
  if (cacheEntry.targetNeuronInfo) {
    getLogger().info("--- Target Neuron Info ---");
    getLogger().info(JSON.stringify(cacheEntry.targetNeuronInfo, null, 2));
    getLogger().info("");
  }

  // Log actual changes
  if (cacheEntry.actualCreatureChange) {
    getLogger().info("--- Actual Creature Changes ---");
    getLogger().info(JSON.stringify(cacheEntry.actualCreatureChange, null, 2));
    getLogger().info("");
  }

  getLogger().info("=".repeat(80));
}
