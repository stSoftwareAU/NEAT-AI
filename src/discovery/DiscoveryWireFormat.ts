import { TopologyError } from "@errors/TopologyError.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CoordinatedStructuralCandidate,
  CoordinatedStructuralOperation,
} from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import {
  buildRuntimeIdToWireMap,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import type { Creature } from "@creature";
import type {
  DiscoveredNeuronDetails,
  DiscoveryCandidate,
  SynapseRemovalDetails,
} from "@discovery/DiscoveryCandidates.ts";

export const DISCOVERY_WIRE_SCHEMA_VERSION = 2;

export interface WireCandidateSynapse extends CandidateSynapse {}

export interface WireCandidateNeuron extends CandidateNeuron {}

export interface WireCandidateSquash extends CandidateSquash {}

export interface WireRemovalCandidate extends RemovalCandidate {}

export interface WireCandidateHarmfulNeuron extends CandidateHarmfulNeuron {}

export interface WireDiscoveredNeuronDetails extends DiscoveredNeuronDetails {}

export interface WireSynapseRemovalDetails extends SynapseRemovalDetails {}

type WireCoordinatedOperation =
  | {
    type: "removeSynapse";
    fromNeuronUuid: string;
    toNeuronUuid: string;
  }
  | {
    type: "addSynapse";
    fromNeuronUuid: string;
    toNeuronUuid: string;
    weight: number;
  }
  | {
    type: "setWeight";
    fromNeuronUuid: string;
    toNeuronUuid: string;
    weight: number;
  }
  | {
    type: "addNeuron";
    neuronUuid: string;
    neuronType: "hidden" | "output";
    squash: string;
    bias: number;
    insertBeforeNeuronUuid?: string;
  }
  | {
    type: "removeNeuron";
    neuronUuid: string;
  }
  | {
    type: "changeSquash";
    neuronUuid: string;
    squash: string;
  }
  | {
    type: "setBias";
    neuronUuid: string;
    bias: number;
  };

export interface WireCoordinatedStructuralCandidate
  extends Omit<CoordinatedStructuralCandidate, "operations"> {
  operations: WireCoordinatedOperation[];
}

export interface DiscoveryWireRequest {
  neuronDetails?: WireDiscoveredNeuronDetails;
  neuronCandidate?: WireCandidateNeuron;
  coordinatedStructuralCandidate?: WireCoordinatedStructuralCandidate;
  synapseCandidate?: WireCandidateSynapse;
  squashCandidate?: WireCandidateSquash;
  removalCandidate?: WireRemovalCandidate;
  harmfulNeuronCandidate?: WireCandidateHarmfulNeuron;
  harmfulSynapseCandidate?: WireCandidateSynapse;
  synapseDetails?: WireSynapseRemovalDetails;
}

function requireWireUuid(
  wireUuid: string,
  label: string,
): string {
  if (wireUuid.length > 0) return wireUuid;
  throw new TopologyError(
    `Discovery wire payload is missing stable uuid for ${label}`,
    "MISSING_NEURON_UUID",
  );
}

function toWireCandidateSynapse(
  _idToWire: Map<number, string>,
  candidate: CandidateSynapse,
): WireCandidateSynapse {
  return {
    ...candidate,
    fromNeuronUuid: requireWireUuid(candidate.fromNeuronUuid, "synapse source"),
    toNeuronUuid: requireWireUuid(candidate.toNeuronUuid, "synapse target"),
  };
}

function toWireCandidateNeuron(
  _idToWire: Map<number, string>,
  candidate: CandidateNeuron,
): WireCandidateNeuron {
  return {
    ...candidate,
    fromNeuronUuid: requireWireUuid(
      candidate.fromNeuronUuid,
      "neuron candidate source",
    ),
    toNeuronUuid: requireWireUuid(
      candidate.toNeuronUuid,
      "neuron candidate target",
    ),
  };
}

function toWireCandidateSquash(
  _idToWire: Map<number, string>,
  candidate: CandidateSquash,
): WireCandidateSquash {
  return {
    ...candidate,
    neuronUuid: requireWireUuid(
      candidate.neuronUuid,
      "squash candidate neuron",
    ),
  };
}

function toWireRemovalCandidate(
  _idToWire: Map<number, string>,
  candidate: RemovalCandidate,
): WireRemovalCandidate {
  return {
    ...candidate,
    neuronUuid: requireWireUuid(
      candidate.neuronUuid,
      "removal candidate neuron",
    ),
  };
}

function toWireCandidateHarmfulNeuron(
  _idToWire: Map<number, string>,
  candidate: CandidateHarmfulNeuron,
): WireCandidateHarmfulNeuron {
  return {
    ...candidate,
    neuronUuid: requireWireUuid(
      candidate.neuronUuid,
      "harmful neuron candidate",
    ),
  };
}

function toWireNeuronDetails(
  _idToWire: Map<number, string>,
  details: DiscoveredNeuronDetails,
): WireDiscoveredNeuronDetails {
  return {
    ...details,
    fromNeuronUuid: requireWireUuid(
      details.fromNeuronUuid,
      "neuron details source",
    ),
    toNeuronUuid: requireWireUuid(
      details.toNeuronUuid,
      "neuron details target",
    ),
  };
}

function toWireSynapseDetails(
  _idToWire: Map<number, string>,
  details: SynapseRemovalDetails,
): WireSynapseRemovalDetails {
  return {
    ...details,
    fromNeuronUuid: requireWireUuid(
      details.fromNeuronUuid,
      "synapse details source",
    ),
    toNeuronUuid: requireWireUuid(
      details.toNeuronUuid,
      "synapse details target",
    ),
  };
}

function toWireCoordinatedOperation(
  _baseIdToWire: Map<number, string>,
  _candidateIdToWire: Map<number, string>,
  op: CoordinatedStructuralOperation,
): WireCoordinatedOperation {
  switch (op.type) {
    case "removeSynapse":
      return {
        type: op.type,
        fromNeuronUuid: requireWireUuid(
          op.fromNeuronUuid,
          "coordinated removeSynapse source",
        ),
        toNeuronUuid: requireWireUuid(
          op.toNeuronUuid,
          "coordinated removeSynapse target",
        ),
      };
    case "addSynapse":
      return {
        type: op.type,
        fromNeuronUuid: requireWireUuid(
          op.fromNeuronUuid,
          "coordinated addSynapse source",
        ),
        toNeuronUuid: requireWireUuid(
          op.toNeuronUuid,
          "coordinated addSynapse target",
        ),
        weight: op.weight,
      };
    case "setWeight":
      return {
        type: op.type,
        fromNeuronUuid: requireWireUuid(
          op.fromNeuronUuid,
          "coordinated setWeight source",
        ),
        toNeuronUuid: requireWireUuid(
          op.toNeuronUuid,
          "coordinated setWeight target",
        ),
        weight: op.weight,
      };
    case "addNeuron":
      return {
        type: op.type,
        neuronUuid: requireWireUuid(
          op.neuronUuid,
          "coordinated addNeuron neuron",
        ),
        neuronType: op.neuronType,
        squash: op.squash,
        bias: op.bias,
        insertBeforeNeuronUuid: op.insertBeforeNeuronUuid === undefined
          ? undefined
          : requireWireUuid(
            op.insertBeforeNeuronUuid,
            "coordinated addNeuron insertion anchor",
          ),
      };
    case "removeNeuron":
      return {
        type: op.type,
        neuronUuid: requireWireUuid(
          op.neuronUuid,
          "coordinated removeNeuron neuron",
        ),
      };
    case "changeSquash":
      return {
        type: op.type,
        neuronUuid: requireWireUuid(
          op.neuronUuid,
          "coordinated changeSquash neuron",
        ),
        squash: op.squash,
      };
    case "setBias":
      return {
        type: op.type,
        neuronUuid: requireWireUuid(
          op.neuronUuid,
          "coordinated setBias neuron",
        ),
        bias: op.bias,
      };
  }
}

function toWireCoordinatedStructuralCandidate(
  baseCreature: Creature,
  candidateCreature: Creature,
  candidate: CoordinatedStructuralCandidate,
): WireCoordinatedStructuralCandidate {
  const baseIdToWire = buildRuntimeIdToWireMap(baseCreature);
  const candidateIdToWire = buildRuntimeIdToWireMap(candidateCreature);
  return {
    ...candidate,
    operations: candidate.operations.map((op) =>
      toWireCoordinatedOperation(baseIdToWire, candidateIdToWire, op)
    ),
  };
}

const LEGACY_DISCOVERY_ID_KEYS = new Set([
  "fromNeuronId",
  "toNeuronId",
  "neuronId",
  "fromId",
  "toId",
  "insertBeforeNeuronId",
  "removedNeuronIds",
]);

export function assertNoLegacyDiscoveryIdFields(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (LEGACY_DISCOVERY_ID_KEYS.has(key)) {
        throw new TopologyError(
          `Discovery wire payload leaked runtime id field '${key}'`,
          "INVALID_STATE",
        );
      }
      stack.push(nested);
    }
  }
}

export function buildDiscoveryWireRequest(
  baseCreature: Creature,
  candidate: DiscoveryCandidate,
): DiscoveryWireRequest {
  const idToWire = buildRuntimeIdToWireMap(baseCreature);
  const request: DiscoveryWireRequest = {};

  if (candidate.change.neuronDetails) {
    request.neuronDetails = toWireNeuronDetails(
      idToWire,
      candidate.change.neuronDetails,
    );
  }
  if (candidate.change.neuronCandidate) {
    request.neuronCandidate = toWireCandidateNeuron(
      idToWire,
      candidate.change.neuronCandidate,
    );
  }
  if (candidate.change.coordinatedStructuralCandidate) {
    request.coordinatedStructuralCandidate =
      toWireCoordinatedStructuralCandidate(
        baseCreature,
        candidate.creature,
        candidate.change.coordinatedStructuralCandidate,
      );
  }
  if (candidate.change.synapseCandidate) {
    request.synapseCandidate = toWireCandidateSynapse(
      idToWire,
      candidate.change.synapseCandidate,
    );
  }
  if (candidate.change.squashCandidate) {
    request.squashCandidate = toWireCandidateSquash(
      idToWire,
      candidate.change.squashCandidate,
    );
  }
  if (candidate.change.removalCandidate) {
    request.removalCandidate = toWireRemovalCandidate(
      idToWire,
      candidate.change.removalCandidate,
    );
  }
  if (candidate.change.harmfulNeuronCandidate) {
    request.harmfulNeuronCandidate = toWireCandidateHarmfulNeuron(
      idToWire,
      candidate.change.harmfulNeuronCandidate,
    );
  }
  if (candidate.change.harmfulSynapseCandidate) {
    request.harmfulSynapseCandidate = toWireCandidateSynapse(
      idToWire,
      candidate.change.harmfulSynapseCandidate,
    );
  }
  if (candidate.change.synapseDetails) {
    request.synapseDetails = toWireSynapseDetails(
      idToWire,
      candidate.change.synapseDetails,
    );
  }

  assertNoLegacyDiscoveryIdFields(request);
  return request;
}
