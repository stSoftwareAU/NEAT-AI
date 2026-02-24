/**
 * Replay Entry Application Module
 *
 * Handles applying success cache entries to creatures during replay,
 * including detecting already-applied changes and applying structural
 * modifications via the Rust discovery request data.
 *
 * Extracted from DiscoveryReplayRunner.ts as part of #1598.
 */

import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import {
  applyCoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import type { Creature } from "../Creature.ts";
import { formatWeight } from "./FailureCache.ts";
import type { SuccessCacheEntry } from "./SuccessCache.ts";

function getRustRequest(entry: SuccessCacheEntry): Record<string, unknown> {
  return (entry.rustRequest as Record<string, unknown>) ?? {};
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isNeuronPresent(creature: Creature, uuid: string): boolean {
  return creature.neurons.some((n) => n.uuid === uuid);
}

function isSynapsePresent(
  creature: Creature,
  fromUUID: string,
  toUUID: string,
): boolean {
  const exported = creature.exportJSON();
  return exported.synapses.some((s) =>
    s.fromUUID === fromUUID && s.toUUID === toUUID
  );
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  if (diff <= 1e-12) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return diff <= 1e-7 * scale;
}

/**
 * Determines whether a success cache entry has already been applied to the creature.
 *
 * Checks structural presence of the change (neuron/synapse existence, squash values)
 * to avoid redundant application during replay.
 */
export function isAlreadyApplied(
  creature: Creature,
  entry: SuccessCacheEntry,
): boolean {
  const type = entry.changeType;
  const req = getRustRequest(entry);

  // Fast-path: structural removals.
  if (type === "remove-low-impact") {
    const c = req.removalCandidate as RemovalCandidate | undefined;
    return c?.neuronUUID ? !isNeuronPresent(creature, c.neuronUUID) : false;
  }
  if (type === "remove-neuron") {
    const c = req.harmfulNeuronCandidate as CandidateHarmfulNeuron | undefined;
    return c?.neuronUUID ? !isNeuronPresent(creature, c.neuronUUID) : false;
  }
  if (type === "remove-synapse") {
    const c = req.harmfulSynapseCandidate as CandidateSynapse | undefined;
    if (c?.fromNeuronUUID && c?.toNeuronUUID) {
      return !isSynapsePresent(creature, c.fromNeuronUUID, c.toNeuronUUID);
    }
    const details = req.synapseDetails as {
      fromNeuronUUID?: string;
      toNeuronUUID?: string;
    } | undefined;
    if (details?.fromNeuronUUID && details?.toNeuronUUID) {
      return !isSynapsePresent(
        creature,
        details.fromNeuronUUID,
        details.toNeuronUUID,
      );
    }
    return false;
  }

  if (type === "add-synapses") {
    const c = req.synapseCandidate as CandidateSynapse | undefined;
    if (!c?.fromNeuronUUID || !c?.toNeuronUUID) return false;
    return isSynapsePresent(creature, c.fromNeuronUUID, c.toNeuronUUID);
  }

  if (type === "change-squash") {
    const c = req.squashCandidate as CandidateSquash | undefined;
    if (!c?.neuronUUID || !c?.squash) return false;
    const neuron = creature.neurons.find((n) => n.uuid === c.neuronUUID);
    return neuron?.squash === c.squash;
  }

  // Coordinated structural candidates are multi-op groups and may not be
  // trivially "already applied" (eg remove/remove/add sequences).
  // We treat them as already applied only when we can verify every operation.
  if (type === "coordinated-structural") {
    const spec = req.coordinatedStructuralCandidate as
      | CoordinatedStructuralCandidate
      | undefined;
    const ops = spec?.operations;
    if (!Array.isArray(ops) || ops.length === 0) return false;

    // Reduce the ordered operation list into a final expected state per edge.
    // This handles weight adjustments that Rust expresses as remove+add on the
    // same synapse: the last op wins.
    const expectedByEdge = new Map<
      string,
      { present: boolean; weight?: number }
    >();
    const edgeKey = (fromUUID: string, toUUID: string): string =>
      `${fromUUID}\0${toUUID}`;

    for (const op of ops) {
      if (!op || typeof op.type !== "string") return false;
      if (op.type === "removeSynapse") {
        expectedByEdge.set(edgeKey(op.fromNeuronUuid, op.toNeuronUuid), {
          present: false,
        });
        continue;
      }
      if (op.type === "addSynapse") {
        expectedByEdge.set(edgeKey(op.fromNeuronUuid, op.toNeuronUuid), {
          present: true,
          weight: op.weight,
        });
        continue;
      }
      if (op.type === "setWeight") {
        const key = edgeKey(op.fromNeuronUuid, op.toNeuronUuid);
        const existing = expectedByEdge.get(key);
        // setWeight is a no-op if the synapse doesn't exist. If the edge is
        // already marked as absent (from a prior removeSynapse), leave it absent.
        if (existing?.present === false) {
          // No-op: leave the edge as absent.
          continue;
        }
        // Otherwise, update the weight (synapse must be present).
        expectedByEdge.set(key, {
          present: true,
          weight: op.weight,
        });
        continue;
      }
      // Unknown op: do not assume applied.
      return false;
    }

    const exported = creature.exportJSON();
    for (const [key, expected] of expectedByEdge.entries()) {
      const [fromUUID, toUUID] = key.split("\0");
      const synapse = exported.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === toUUID
      );

      if (!expected.present) {
        if (synapse) return false;
        continue;
      }

      if (!synapse) return false;
      if (expected.weight === undefined) return false;
      if (!nearlyEqual(synapse.weight, expected.weight)) return false;
    }

    return true;
  }

  if (type === "add-neurons") {
    // Approximate match using the same exponent-bucketing approach as the cache key.
    const details = req.neuronDetails as {
      fromNeuronUUID?: string;
      toNeuronUUID?: string;
      incomingWeight?: number;
      outgoingWeight?: number;
      bias?: number;
      squash?: string;
    } | undefined;
    const fromUUID = details?.fromNeuronUUID;
    const toUUID = details?.toNeuronUUID;
    if (!fromUUID || !toUUID) return false;

    const inW = safeNumber(details?.incomingWeight);
    const outW = safeNumber(details?.outgoingWeight);
    const bias = safeNumber(details?.bias);
    const squash = typeof details?.squash === "string"
      ? details.squash
      : undefined;
    if (
      inW === undefined || outW === undefined || bias === undefined || !squash
    ) {
      return false;
    }

    const inExp = formatWeight(inW);
    const outExp = formatWeight(outW);
    const biasExp = formatWeight(bias);

    // Find a hidden neuron with matching squash + bias magnitude that links from->hidden->to
    const exported = creature.exportJSON();
    for (const neuron of creature.neurons) {
      if (neuron.type !== "hidden") continue;
      if (neuron.squash !== squash) continue;
      if (formatWeight(neuron.bias) !== biasExp) continue;

      const inSyn = exported.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === neuron.uuid
      );
      const outSyn = exported.synapses.find((s) =>
        s.fromUUID === neuron.uuid && s.toUUID === toUUID
      );
      if (!inSyn || !outSyn) continue;
      if (formatWeight(inSyn.weight) !== inExp) continue;
      if (formatWeight(outSyn.weight) !== outExp) continue;
      return true;
    }
    return false;
  }

  // Unknown type: do not assume applied.
  return false;
}

/**
 * Applies a success cache entry to a creature using the stored Rust request data.
 *
 * Each entry type maps to a specific `DiscoverStructure` method that performs
 * the structural modification.
 */
export function applyEntryUsingRustRequest(
  baseCreature: Creature,
  entry: SuccessCacheEntry,
): Creature | undefined {
  const req = getRustRequest(entry);
  const discoveryID = entry.key || "replay";

  switch (entry.changeType) {
    case "coordinated-structural": {
      const coordinated = req.coordinatedStructuralCandidate as
        | CoordinatedStructuralCandidate
        | undefined;
      if (!coordinated) return undefined;
      return applyCoordinatedStructuralCandidate(baseCreature, coordinated);
    }
    case "add-synapses": {
      const synapse = req.synapseCandidate as CandidateSynapse | undefined;
      if (!synapse) return undefined;
      return DiscoverStructure.addHelpfulSynapses(
        discoveryID,
        baseCreature,
        [synapse],
      );
    }
    case "add-neurons": {
      const neuron = req.neuronCandidate as CandidateNeuron | undefined;
      if (!neuron) return undefined;
      return DiscoverStructure.addHelpfulNeurons(
        discoveryID,
        baseCreature,
        [neuron],
      );
    }
    case "change-squash": {
      const squash = req.squashCandidate as CandidateSquash | undefined;
      if (!squash) return undefined;
      return DiscoverStructure.changeSquash(
        discoveryID,
        baseCreature,
        [squash],
      );
    }
    case "remove-synapse": {
      const synapse =
        (req.harmfulSynapseCandidate as CandidateSynapse | undefined) ??
          (req.synapseCandidate as CandidateSynapse | undefined);
      const details = req.synapseDetails as
        | { fromNeuronUUID?: string; toNeuronUUID?: string }
        | undefined;
      const resolved = synapse ??
        (details?.fromNeuronUUID && details?.toNeuronUUID
          ? {
            fromNeuronUUID: details.fromNeuronUUID,
            toNeuronUUID: details.toNeuronUUID,
            weight: 0,
            targetNeuronImpact: 0,
            expectedCreatureErrorReduction: 0,
            expectedCreatureScoreGain: 0,
            improvedCount: 0,
            totalCount: 0,
          } satisfies CandidateSynapse
          : undefined);
      if (!resolved) return undefined;
      const removed = DiscoverStructure.removeSynapse(
        discoveryID,
        baseCreature,
        resolved,
      );
      return removed ?? undefined;
    }
    case "remove-neuron": {
      const neuron = req.harmfulNeuronCandidate as
        | CandidateHarmfulNeuron
        | undefined;
      if (!neuron) return undefined;
      const removed = DiscoverStructure.removeHarmfulNeuron(
        discoveryID,
        baseCreature,
        neuron,
      );
      return removed ?? undefined;
    }
    case "remove-low-impact": {
      const c = req.removalCandidate as RemovalCandidate | undefined;
      if (!c) return undefined;
      const removed = DiscoverStructure.removeLowImpactNeuron(
        discoveryID,
        baseCreature,
        c,
      );
      return removed ?? undefined;
    }
    default:
      return undefined;
  }
}
