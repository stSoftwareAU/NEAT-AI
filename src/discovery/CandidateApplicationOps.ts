/**
 * Candidate Application Operations Module
 *
 * Low-level operations for applying specific types of discovery changes
 * (add neurons, add synapses, change squash, remove neurons/synapses)
 * to creature exports.
 *
 * Extracted from CandidateApplication.ts as part of #1598.
 */

import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
} from "../compact/CompactUtils.ts";
import { Creature } from "../Creature.ts";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";
import {
  buildUuidToIndexMap,
  validateAndFixCreatureSync,
} from "./CandidateApplication.ts";

export function applyAddSynapses(
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  enforceForwardOnly: boolean,
  uuidToIndex: Map<string, number> | undefined,
): Creature | undefined {
  // Find synapses in candidate that don't exist in creature
  const existingSynapses = new Set(
    creatureJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );
  // Build set of existing neuron UUIDs to validate synapse endpoints
  // Include input neurons (not in neurons array but referenced as input-N)
  const existingNeurons = new Set(
    creatureJSON.neurons.map((n: { uuid: string }) => n.uuid),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    existingNeurons.add(`input-${i}`);
  }
  // Only add synapses where BOTH endpoints exist in current creature
  // (handles combinations where neurons were removed by prior steps)
  const newSynapses = candidateJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
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
  if (newSynapses.length === 0) return undefined;

  creatureJSON.synapses.push(...newSynapses);
  const result = Creature.fromJSON(creatureJSON);
  delete result.uuid;
  validateAndFixCreatureSync(result, "add-synapses");
  CreatureUtil.makeUUID(result);
  return result;
}

export function applyAddNeurons(
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  enforceForwardOnly: boolean,
): Creature | undefined {
  // Find neurons in candidate that don't exist in creature
  const existingNeurons = new Set(
    creatureJSON.neurons.map((n: { uuid: string }) => n.uuid),
  );
  const candidateNeurons = candidateJSON.neurons.filter(
    (n: { type: string; uuid: string }) =>
      n.type === "hidden" && !existingNeurons.has(n.uuid),
  );
  if (candidateNeurons.length === 0) return undefined;

  // Insert new neurons in a forward-pass-safe position based on the *candidate*
  // neurone ordering (not by guessing from a single outgoing synapse).
  const newNeuronUUIDs = new Set(
    candidateNeurons.map((n) => n.uuid),
  );
  const candidateNewNeuronMap = new Map(
    candidateNeurons.map((n) => [n.uuid, n] as const),
  );
  const END_ANCHOR = "__END__";

  const anchorToNewNeurons = new Map<
    string,
    typeof candidateNeurons
  >();
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
  const remaining = candidateNeurons.filter(
    (n: { uuid: string }) => !inserted.has(n.uuid),
  );
  if (remaining.length > 0) {
    const firstOutputIndex = mergedNeurons.findIndex(
      (n: { type: string }) => n.type === "output",
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
    creatureJSON.neurons.map((n: { uuid: string }) => n.uuid),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    updatedNeurons.add(`input-${i}`);
  }

  const uuidToIndexAfterInsertion = enforceForwardOnly
    ? buildUuidToIndexMap(creatureJSON)
    : undefined;

  // Find synapses connected to these new neurons
  // Only include synapses where BOTH endpoints exist in current creature
  const newSynapses = candidateJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
      (newNeuronUUIDs.has(s.fromUUID) || newNeuronUUIDs.has(s.toUUID)) &&
      updatedNeurons.has(s.fromUUID) &&
      updatedNeurons.has(s.toUUID) &&
      (!enforceForwardOnly ||
        (() => {
          const from = uuidToIndexAfterInsertion?.get(s.fromUUID);
          const to = uuidToIndexAfterInsertion?.get(s.toUUID);
          // Forward-only: reject self-loops and back connections.
          return from !== undefined && to !== undefined && from < to;
        })()),
  );
  creatureJSON.synapses.push(...newSynapses);

  const result = Creature.fromJSON(creatureJSON);
  delete result.uuid;
  validateAndFixCreatureSync(result, "add-neurons");
  CreatureUtil.makeUUID(result);
  return result;
}

export function applyChangeSquash(
  creature: Creature,
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  candidate: DiscoveryCandidate,
): Creature | undefined {
  // Apply ONLY the intended squash change for this candidate.
  const targetUUID = candidate.change.squashCandidate?.neuronUUID;
  const targetSquash = candidate.change.squashCandidate?.squash;
  if (targetUUID && targetSquash) {
    let changed = false;
    for (const neuron of creatureJSON.neurons) {
      if (neuron.uuid !== targetUUID) continue;
      if (neuron.squash !== targetSquash) {
        neuron.squash = targetSquash;
        changed = true;
      }
      break;
    }
    if (!changed) return creature;
  } else {
    // Fallback (older candidates): apply by diffing candidate vs current, but only
    // for neurons that differ AND are present in the current creature.
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
  }

  const result = Creature.fromJSON(creatureJSON);
  delete result.uuid;
  validateAndFixCreatureSync(result, "change-squash");
  CreatureUtil.makeUUID(result);
  return result;
}

export function applyRemoveSynapse(
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  baseJSON: CreatureExport,
  enforceForwardOnly: boolean,
  uuidToIndex: Map<string, number> | undefined,
): Creature | undefined {
  // Find synapses that were in base but removed in candidate
  const baseSynapses = new Set(
    baseJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );
  const candidateSynapses = new Set(
    candidateJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );
  const creatureSynapses = new Set(
    creatureJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );

  // Synapses to remove: existed in base but not in candidate
  const toRemove = new Set(
    [...baseSynapses].filter((key) => !candidateSynapses.has(key)),
  );

  // Also add reconnection synapses: new in candidate but not in creature
  // These maintain connectivity after removal
  const toAdd = candidateJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
      !baseSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
      !creatureSynapses.has(`${s.fromUUID}->${s.toUUID}`) &&
      (!enforceForwardOnly ||
        (() => {
          const from = uuidToIndex?.get(s.fromUUID);
          const to = uuidToIndex?.get(s.toUUID);
          return from !== undefined && to !== undefined && from < to;
        })()),
  );

  if (toRemove.size === 0 && toAdd.length === 0) return undefined;

  creatureJSON.synapses = creatureJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
      !toRemove.has(`${s.fromUUID}->${s.toUUID}`),
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

export function applyRemoveNeuron(
  creature: Creature,
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  baseJSON: CreatureExport,
  enforceForwardOnly: boolean,
  changeType: DiscoveryChangeType,
): Creature | undefined {
  // Find neurons that were in base but removed in candidate
  const baseNeurons = new Set(
    baseJSON.neurons.filter((n: { type: string }) => n.type === "hidden").map(
      (n: { uuid: string }) => n.uuid,
    ),
  );
  const candidateNeurons = new Set(
    candidateJSON.neurons.map((n: { uuid: string }) => n.uuid),
  );
  const baseSynapses = new Set(
    baseJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );
  const creatureSynapses = new Set(
    creatureJSON.synapses.map((s: { fromUUID: string; toUUID: string }) =>
      `${s.fromUUID}->${s.toUUID}`
    ),
  );

  // Neurons to remove: existed in base (as hidden) but not in candidate
  const toRemove = new Set(
    [...baseNeurons].filter((uuid) => !candidateNeurons.has(uuid)),
  );

  // First, apply the removals
  creatureJSON.neurons = creatureJSON.neurons.filter(
    (n: { uuid: string }) => !toRemove.has(n.uuid),
  );
  creatureJSON.synapses = creatureJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
      !toRemove.has(s.fromUUID) && !toRemove.has(s.toUUID),
  );

  // Clean up memetic data for removed neurons
  for (const neuronUUID of toRemove) {
    cleanupMemeticForRemovedNeuron(creatureJSON, neuronUUID);
  }

  // Build set of remaining neuron UUIDs for synapse validation
  // Include input neurons (not in neurons array but referenced as input-N)
  const remainingNeurons = new Set(
    creatureJSON.neurons.map((n: { uuid: string }) => n.uuid),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    remainingNeurons.add(`input-${i}`);
  }

  const uuidToIndexAfterRemovals = enforceForwardOnly
    ? buildUuidToIndexMap(creatureJSON)
    : undefined;

  // Add reconnection synapses: new in candidate but not in creature
  const toAdd = candidateJSON.synapses.filter(
    (s: { fromUUID: string; toUUID: string }) =>
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
