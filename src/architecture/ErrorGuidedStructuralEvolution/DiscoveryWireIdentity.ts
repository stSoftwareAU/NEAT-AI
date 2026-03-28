import type { Creature } from "../../Creature.ts";
import type {
  CandidateNeuron,
  CandidateSynapse,
} from "./DiscoverStructureTypes.ts";
import type {
  CoordinatedAddSynapseOperation,
  CoordinatedRemoveSynapseOperation,
  CoordinatedSetWeightOperation,
} from "./CoordinatedStructuralCandidate.ts";
import { neuronUuid } from "../../neuron/NeuronSerialization.ts";

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
