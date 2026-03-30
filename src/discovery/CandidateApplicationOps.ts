/**
 * Candidate Application Operations Module
 *
 * Low-level operations for applying specific types of discovery changes
 * (add neurons, add synapses, change squash, remove neurons/synapses)
 * to creature exports.
 *
 * Extracted from CandidateApplication.ts as part of #1598.
 */

import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
} from "@compact/CompactUtils.ts";
import { Creature } from "@creature";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "@discovery/DiscoveryCandidates.ts";
import {
  buildIdToIndexMap,
  validateAndFixCreatureSync,
} from "@discovery/CandidateApplication.ts";

export function applyAddSynapses(
  creatureJSON: CreatureExport,
  candidateJSON: CreatureExport,
  enforceForwardOnly: boolean,
  idToIndex: Map<number, number> | undefined,
): Creature | undefined {
  // Find synapses in candidate that don't exist in creature
  const existingSynapses = new Set(
    creatureJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );
  // Build set of existing neuron IDs to validate synapse endpoints
  // Include input neurons (not in neurons array but referenced by index)
  const existingNeurons = new Set(
    creatureJSON.neurons.map((n) => n.id),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    existingNeurons.add(i);
  }
  // Only add synapses where BOTH endpoints exist in current creature
  // (handles combinations where neurons were removed by prior steps)
  const newSynapses = candidateJSON.synapses.filter(
    (s) =>
      !existingSynapses.has(`${s.fromId!}->${s.toId!}`) &&
      existingNeurons.has(s.fromId!) &&
      existingNeurons.has(s.toId!) &&
      (!enforceForwardOnly ||
        (() => {
          const from = idToIndex?.get(s.fromId!);
          const to = idToIndex?.get(s.toId!);
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
    creatureJSON.neurons.map((n) => n.id),
  );
  const candidateNeurons = candidateJSON.neurons.filter(
    (n) => n.type === "hidden" && !existingNeurons.has(n.id),
  );
  if (candidateNeurons.length === 0) return undefined;

  // Insert new neurons in a forward-pass-safe position based on the *candidate*
  // neurone ordering (not by guessing from a single outgoing synapse).
  const newNeuronIds = new Set(
    candidateNeurons.map((n) => n.id),
  );
  const candidateNewNeuronMap = new Map(
    candidateNeurons.map((n) => [n.id, n] as const),
  );
  const END_ANCHOR = -1;

  const anchorToNewNeurons = new Map<
    number,
    typeof candidateNeurons
  >();
  const candidateIds = candidateJSON.neurons.map((n) => n.id);
  for (let i = 0; i < candidateIds.length; i++) {
    const id = candidateIds[i];
    if (!newNeuronIds.has(id)) continue;

    let anchorId: number | undefined;
    for (let j = i + 1; j < candidateIds.length; j++) {
      const nextId = candidateIds[j];
      if (!newNeuronIds.has(nextId)) {
        anchorId = nextId;
        break;
      }
    }

    const key = anchorId ?? END_ANCHOR;
    const neuron = candidateNewNeuronMap.get(id);
    if (!neuron) continue;
    const list = anchorToNewNeurons.get(key) ?? [];
    list.push(neuron);
    anchorToNewNeurons.set(key, list);
  }

  const inserted = new Set<number>();
  const mergedNeurons: typeof creatureJSON.neurons = [];
  for (const neuron of creatureJSON.neurons) {
    const toInsert = anchorToNewNeurons.get(neuron.id!);
    if (toInsert && toInsert.length > 0) {
      for (const newNeuron of toInsert) {
        if (inserted.has(newNeuron.id!)) continue;
        mergedNeurons.push(newNeuron);
        inserted.add(newNeuron.id!);
      }
    }
    mergedNeurons.push(neuron);
  }

  // Any remaining new neurons (eg, anchor was removed by a prior combo step)
  // are inserted before the first output to keep outputs contiguous.
  const remaining = candidateNeurons.filter(
    (n) => !inserted.has(n.id!),
  );
  if (remaining.length > 0) {
    const firstOutputIndex = mergedNeurons.findIndex(
      (n) => n.type === "output",
    );
    const insertAt = firstOutputIndex >= 0
      ? firstOutputIndex
      : mergedNeurons.length;
    mergedNeurons.splice(insertAt, 0, ...remaining);
    for (const neuron of remaining) inserted.add(neuron.id!);
  }

  creatureJSON.neurons = mergedNeurons;

  // Update existing neurons set to include newly added neurons and input neurons
  const updatedNeurons = new Set(
    creatureJSON.neurons.map((n) => n.id),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    updatedNeurons.add(i);
  }

  const idToIndexAfterInsertion = enforceForwardOnly
    ? buildIdToIndexMap(creatureJSON)
    : undefined;

  // Find synapses connected to these new neurons
  // Only include synapses where BOTH endpoints exist in current creature
  const newSynapses = candidateJSON.synapses.filter(
    (s) =>
      (newNeuronIds.has(s.fromId!) || newNeuronIds.has(s.toId!)) &&
      updatedNeurons.has(s.fromId!) &&
      updatedNeurons.has(s.toId!) &&
      (!enforceForwardOnly ||
        (() => {
          const from = idToIndexAfterInsertion?.get(s.fromId!);
          const to = idToIndexAfterInsertion?.get(s.toId!);
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
  const targetUuid = candidate.change.squashCandidate?.neuronUuid;
  const targetSquash = candidate.change.squashCandidate?.squash;
  if (targetUuid && targetSquash) {
    let changed = false;
    for (const neuron of creatureJSON.neurons) {
      if (neuron.uuid !== targetUuid) continue;
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
      candidateJSON.neurons.map((n) => [n.id, n]),
    );
    let changed = false;
    for (const neuron of creatureJSON.neurons) {
      const candidateNeuron = candidateNeuronMap.get(neuron.id);
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
  idToIndex: Map<number, number> | undefined,
): Creature | undefined {
  // Find synapses that were in base but removed in candidate
  const baseSynapses = new Set(
    baseJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );
  const candidateSynapses = new Set(
    candidateJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );
  const creatureSynapses = new Set(
    creatureJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );

  // Synapses to remove: existed in base but not in candidate
  const toRemove = new Set(
    [...baseSynapses].filter((key) => !candidateSynapses.has(key)),
  );

  // Also add reconnection synapses: new in candidate but not in creature
  // These maintain connectivity after removal
  const toAdd = candidateJSON.synapses.filter(
    (s) =>
      !baseSynapses.has(`${s.fromId!}->${s.toId!}`) &&
      !creatureSynapses.has(`${s.fromId!}->${s.toId!}`) &&
      (!enforceForwardOnly ||
        (() => {
          const from = idToIndex?.get(s.fromId!);
          const to = idToIndex?.get(s.toId!);
          return from !== undefined && to !== undefined && from < to;
        })()),
  );

  if (toRemove.size === 0 && toAdd.length === 0) return undefined;

  creatureJSON.synapses = creatureJSON.synapses.filter(
    (s) => !toRemove.has(`${s.fromId}->${s.toId}`),
  );

  // Clean up memetic data for removed synapses
  for (const synapseKey of toRemove) {
    const [fromIdStr, toIdStr] = synapseKey.split("->");
    cleanupMemeticForRemovedSynapse(
      creatureJSON,
      Number(fromIdStr),
      Number(toIdStr),
    );
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
    baseJSON.neurons.filter((n) => n.type === "hidden").map(
      (n) => n.id,
    ),
  );
  const candidateNeurons = new Set(
    candidateJSON.neurons.map((n) => n.id),
  );
  const baseSynapses = new Set(
    baseJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );
  const creatureSynapses = new Set(
    creatureJSON.synapses.map((s) => `${s.fromId}->${s.toId}`),
  );

  // Neurons to remove: existed in base (as hidden) but not in candidate
  const toRemove = new Set(
    [...baseNeurons].filter((id) => !candidateNeurons.has(id)),
  );

  // First, apply the removals
  creatureJSON.neurons = creatureJSON.neurons.filter(
    (n) => !toRemove.has(n.id),
  );
  creatureJSON.synapses = creatureJSON.synapses.filter(
    (s) => !toRemove.has(s.fromId) && !toRemove.has(s.toId),
  );

  // Clean up memetic data for removed neurons (use wire uuid: neuron rows are
  // already stripped from creatureJSON, so runtime id → wire lookup would fail).
  for (const neuronId of toRemove) {
    const removed = baseJSON.neurons.find((n) => n.id === neuronId);
    cleanupMemeticForRemovedNeuron(
      creatureJSON,
      removed?.uuid ?? neuronId!,
    );
  }

  // Build set of remaining neuron IDs for synapse validation
  // Include input neurons (not in neurons array but referenced by index)
  const remainingNeurons = new Set(
    creatureJSON.neurons.map((n) => n.id),
  );
  const inputCount = creatureJSON.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    remainingNeurons.add(i);
  }

  const idToIndexAfterRemovals = enforceForwardOnly
    ? buildIdToIndexMap(creatureJSON)
    : undefined;

  // Add reconnection synapses: new in candidate but not in creature
  const toAdd = candidateJSON.synapses.filter(
    (s) =>
      !baseSynapses.has(`${s.fromId!}->${s.toId!}`) &&
      !creatureSynapses.has(`${s.fromId!}->${s.toId!}`) &&
      remainingNeurons.has(s.fromId!) &&
      remainingNeurons.has(s.toId!) &&
      (!enforceForwardOnly ||
        (() => {
          const from = idToIndexAfterRemovals?.get(s.fromId!);
          const to = idToIndexAfterRemovals?.get(s.toId!);
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
