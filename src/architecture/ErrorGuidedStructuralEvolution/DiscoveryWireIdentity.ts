import type { Creature } from "@creature";
import type {
  CandidateNeuron,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import type {
  CoordinatedAddSynapseOperation,
  CoordinatedRemoveSynapseOperation,
  CoordinatedSetWeightOperation,
} from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

export function buildWireToRuntimeIdMap(
  creature: Creature,
): Map<string, number> {
  const wireToId = new Map<string, number>();
  for (let i = 0; i < creature.input; i++) {
    wireToId.set(`input-${i}`, i);
  }
  for (const neuron of creature.neurons) {
    if (neuron.type === "input") continue;
    wireToId.set(neuronUuid(neuron), neuron.id);
  }
  return wireToId;
}

export function buildRuntimeIdToWireMap(
  creature: Creature,
): Map<number, string> {
  const idToWire = new Map<number, string>();
  for (let i = 0; i < creature.input; i++) {
    idToWire.set(i, `input-${i}`);
  }
  for (const neuron of creature.neurons) {
    if (neuron.type === "input") continue;
    idToWire.set(neuron.id, neuronUuid(neuron));
  }
  return idToWire;
}

export function resolveWireToRuntimeId(
  wireToId: Map<string, number>,
  wireUuid: string,
): number | undefined {
  return wireToId.get(wireUuid);
}

/**
 * Resolve a mixed list of forced-focus references to runtime neuron ids.
 *
 * References may be:
 *   - a numeric runtime id (used directly), or
 *   - a stable wire UUID string such as `input-2460` or a hidden/output
 *     neuron UUID (resolved to a runtime id against `creature`), or
 *   - a bare integer string such as `"42"` (treated as a runtime id).
 *
 * Order and identity are preserved. Empty and unresolvable string tokens are
 * returned in `unresolved` so the caller can report them loudly rather than
 * silently degrading — a bad identifier is never swallowed without a trace.
 */
export function resolveForcedFocusReferences(
  creature: Creature,
  refs: readonly (number | string)[],
): { ids: number[]; unresolved: string[] } {
  const wireToId = buildWireToRuntimeIdMap(creature);
  const ids: number[] = [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    if (typeof ref === "number" && Number.isInteger(ref)) {
      ids.push(ref);
      continue;
    }
    if (typeof ref !== "string") {
      continue;
    }
    const token = ref.trim();
    if (token.length === 0) {
      continue;
    }
    const resolved = wireToId.get(token);
    if (resolved !== undefined) {
      ids.push(resolved);
      continue;
    }
    // Fall back to a bare integer string (e.g. "42") = runtime id.
    const asInt = Number(token);
    if (Number.isInteger(asInt)) {
      ids.push(asInt);
      continue;
    }
    unresolved.push(token);
  }
  return { ids, unresolved };
}

export function resolveRuntimeIdToWireUuid(
  idToWire: Map<number, string>,
  runtimeId: number | undefined,
): string | undefined {
  if (typeof runtimeId !== "number" || !Number.isFinite(runtimeId)) {
    return undefined;
  }
  return idToWire.get(runtimeId);
}

export function resolveSingleNeuronReference(
  wireToId: Map<string, number>,
  neuronUuid: string,
): number | undefined {
  return resolveWireToRuntimeId(wireToId, neuronUuid);
}

export function resolveCandidateSynapseEndpoints(
  wireToId: Map<string, number>,
  candidate: CandidateSynapse,
): { fromId: number; toId: number } | undefined {
  const fromId = resolveWireToRuntimeId(
    wireToId,
    candidate.fromNeuronUuid,
  );
  const toId = resolveWireToRuntimeId(
    wireToId,
    candidate.toNeuronUuid,
  );
  if (fromId === undefined || toId === undefined) {
    return undefined;
  }
  return { fromId, toId };
}

export function resolveCandidateNeuronEndpoints(
  wireToId: Map<string, number>,
  candidate: CandidateNeuron,
): { fromId: number; toId: number } | undefined {
  const fromId = resolveWireToRuntimeId(
    wireToId,
    candidate.fromNeuronUuid,
  );
  const toId = resolveWireToRuntimeId(
    wireToId,
    candidate.toNeuronUuid,
  );
  if (fromId === undefined || toId === undefined) {
    return undefined;
  }
  return { fromId, toId };
}

type EdgeOp =
  | CoordinatedRemoveSynapseOperation
  | CoordinatedAddSynapseOperation
  | CoordinatedSetWeightOperation;

export function resolveCoordinatedEdgeEndpoints(
  wireToId: Map<string, number>,
  op: EdgeOp,
): { fromId: number; toId: number } | undefined {
  const fromId = resolveWireToRuntimeId(
    wireToId,
    op.fromNeuronUuid,
  );
  const toId = resolveWireToRuntimeId(
    wireToId,
    op.toNeuronUuid,
  );
  if (fromId === undefined || toId === undefined) {
    return undefined;
  }
  return { fromId, toId };
}
