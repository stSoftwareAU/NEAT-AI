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
import {
  buildWireToRuntimeIdMap,
  resolveCandidateNeuronEndpoints,
  resolveCandidateSynapseEndpoints,
  resolveCoordinatedEdgeEndpoints,
  resolveWireToRuntimeId,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import type { Creature } from "../Creature.ts";
import { formatWeight } from "./FailureCache.ts";
import type { SuccessCacheEntry } from "./SuccessCache.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";

function getRustRequest(entry: SuccessCacheEntry): Record<string, unknown> {
  return (entry.rustRequest as Record<string, unknown>) ?? {};
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isNeuronPresent(creature: Creature, id: number): boolean {
  return creature.neurons.some((n) => n.id === id);
}

function isSynapsePresent(
  creature: Creature,
  fromId: number,
  toId: number,
): boolean {
  const exported = creature.exportJSON();
  normaliseCreatureExport(exported);
  return exported.synapses.some((s) => s.fromId === fromId && s.toId === toId);
}

function resolveSynapseDetailsEndpoints(
  creature: Creature,
  details:
    | {
      fromNeuronUuid?: string;
      toNeuronUuid?: string;
    }
    | undefined,
): { fromId: number; toId: number } | undefined {
  if (!details) return undefined;
  const wireToId = buildWireToRuntimeIdMap(creature);
  if (!details.fromNeuronUuid || !details.toNeuronUuid) {
    return undefined;
  }
  const fromId = resolveWireToRuntimeId(
    wireToId,
    details.fromNeuronUuid,
  );
  const toId = resolveWireToRuntimeId(
    wireToId,
    details.toNeuronUuid,
  );
  if (fromId === undefined || toId === undefined) {
    return undefined;
  }
  return { fromId, toId };
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
    if (!c?.neuronUuid) return false;
    const neuronId = resolveWireToRuntimeId(
      buildWireToRuntimeIdMap(creature),
      c.neuronUuid,
    );
    return neuronId !== undefined
      ? !isNeuronPresent(creature, neuronId)
      : false;
  }
  if (type === "remove-neuron") {
    const c = req.harmfulNeuronCandidate as CandidateHarmfulNeuron | undefined;
    if (!c?.neuronUuid) return false;
    const neuronId = resolveWireToRuntimeId(
      buildWireToRuntimeIdMap(creature),
      c.neuronUuid,
    );
    return neuronId !== undefined
      ? !isNeuronPresent(creature, neuronId)
      : false;
  }
  if (type === "remove-synapse") {
    const c = req.harmfulSynapseCandidate as CandidateSynapse | undefined;
    const wireToId = buildWireToRuntimeIdMap(creature);
    const candidateEndpoints = c
      ? resolveCandidateSynapseEndpoints(wireToId, c)
      : undefined;
    if (candidateEndpoints) {
      return !isSynapsePresent(
        creature,
        candidateEndpoints.fromId,
        candidateEndpoints.toId,
      );
    }
    const details = req.synapseDetails as {
      fromNeuronUuid?: string;
      toNeuronUuid?: string;
    } | undefined;
    const detailEndpoints = resolveSynapseDetailsEndpoints(creature, details);
    if (detailEndpoints) {
      return !isSynapsePresent(
        creature,
        detailEndpoints.fromId,
        detailEndpoints.toId,
      );
    }
    return false;
  }

  if (type === "add-synapses") {
    const c = req.synapseCandidate as CandidateSynapse | undefined;
    if (!c) return false;
    const endpoints = resolveCandidateSynapseEndpoints(
      buildWireToRuntimeIdMap(creature),
      c,
    );
    if (!endpoints) return false;
    return isSynapsePresent(creature, endpoints.fromId, endpoints.toId);
  }

  if (type === "change-squash") {
    const c = req.squashCandidate as CandidateSquash | undefined;
    if (!c?.neuronUuid) {
      return false;
    }
    const neuronId = resolveWireToRuntimeId(
      buildWireToRuntimeIdMap(creature),
      c.neuronUuid,
    );
    if (neuronId === undefined || !c?.squash) {
      return false;
    }
    const neuron = creature.neurons.find((n) => n.id === neuronId);
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
    const edgeKey = (fromId: number, toId: number): string =>
      `${fromId}\0${toId}`;
    const wireToId = buildWireToRuntimeIdMap(creature);

    for (const op of ops) {
      if (!op || typeof op.type !== "string") return false;
      if (op.type === "removeSynapse") {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) return false;
        expectedByEdge.set(edgeKey(endpoints.fromId, endpoints.toId), {
          present: false,
        });
        continue;
      }
      if (op.type === "addSynapse") {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) return false;
        expectedByEdge.set(edgeKey(endpoints.fromId, endpoints.toId), {
          present: true,
          weight: op.weight,
        });
        continue;
      }
      if (op.type === "setWeight") {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) return false;
        const key = edgeKey(endpoints.fromId, endpoints.toId);
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
    normaliseCreatureExport(exported);
    for (const [key, expected] of expectedByEdge.entries()) {
      const [fromIdStr, toIdStr] = key.split("\0");
      const fromId = Number(fromIdStr);
      const toId = Number(toIdStr);
      const synapse = exported.synapses.find((s) =>
        s.fromId === fromId && s.toId === toId
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
      fromNeuronUuid?: string;
      toNeuronUuid?: string;
      incomingWeight?: number;
      outgoingWeight?: number;
      bias?: number;
      squash?: string;
    } | undefined;
    const endpoints = details
      ? resolveCandidateNeuronEndpoints(
        buildWireToRuntimeIdMap(creature),
        details as CandidateNeuron,
      )
      : undefined;
    const fromId = endpoints?.fromId;
    const toId = endpoints?.toId;
    if (fromId === undefined || toId === undefined) return false;

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
    normaliseCreatureExport(exported);
    for (const neuron of creature.neurons) {
      if (neuron.type !== "hidden") continue;
      if (neuron.squash !== squash) continue;
      if (formatWeight(neuron.bias) !== biasExp) continue;

      const inSyn = exported.synapses.find((s) =>
        s.fromId === fromId && s.toId === neuron.id
      );
      const outSyn = exported.synapses.find((s) =>
        s.fromId === neuron.id && s.toId === toId
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
        | {
          fromNeuronUuid?: string;
          toNeuronUuid?: string;
        }
        | undefined;
      const resolved = synapse ??
        (details &&
            details.fromNeuronUuid &&
            details.toNeuronUuid
          ? {
            fromNeuronUuid: details.fromNeuronUuid,
            toNeuronUuid: details.toNeuronUuid,
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
