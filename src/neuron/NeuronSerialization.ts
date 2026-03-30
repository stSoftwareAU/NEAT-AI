/**
 * NeuronSerialization.ts - JSON import/export for neurons.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import { addTags } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import { Neuron } from "@architecture/Neuron.ts";
import {
  ensureIdAbove,
  isOutputNeuronId,
  nextNeuronId,
  outputIndexFromId,
} from "@architecture/NeuronId.ts";
import type {
  NeuronExport,
  NeuronInternal,
} from "@architecture/NeuronInterfaces.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/**
 * UUID string used in exports and synapse endpoints.
 * - Output neurons: canonical "output-N" (N = output index)
 * - Hidden/constant: stable `neuron.uuid` (set at creation or loaded from JSON)
 */
export function neuronUuid(neuron: Neuron): string {
  if (isOutputNeuronId(neuron.id)) {
    return `output-${outputIndexFromId(neuron.id)}`;
  }
  if (neuron.uuid) {
    return neuron.uuid;
  }
  throw new TopologyError(
    "Hidden or constant neuron is missing a stable uuid",
    "MISSING_NEURON_UUID",
  );
}

/**
 * Wire-style label for validation logs and operator-facing errors (GRQ / Issue #1958).
 * Matches export endpoints (`input-N`, `output-N`, hidden `uuid`) — not runtime integer ids.
 */
export function neuronWireLabelForDiagnostics(
  neuron: Neuron,
  arrayIndex: number,
): string {
  if (neuron.type === "input") {
    return `input-${arrayIndex}`;
  }
  if (isOutputNeuronId(neuron.id)) {
    return `output-${outputIndexFromId(neuron.id)}`;
  }
  if (neuron.uuid) {
    return neuron.uuid;
  }
  return `missing-uuid@index-${arrayIndex}`;
}

/**
 * Converts the neuron to a JSON export object.
 * Wire format uses stable `uuid` only; integer `id` is internal (Issue #1958).
 */
export function exportJSON(neuron: Neuron): NeuronExport {
  if (neuron.type === "input") {
    throw new TopologyError(
      `Should not be exporting 'input'`,
      "INVALID_NEURON_TYPE",
    );
  }

  const uuid = neuronUuid(neuron);

  if (neuron.type === "constant") {
    return {
      type: neuron.type,
      uuid: uuid,
      bias: neuron.bias,
      frozen: neuron.frozen ? true : undefined,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else {
    return {
      type: neuron.type,
      uuid: uuid,
      bias: neuron.bias,
      squash: neuron.squash,
      frozen: neuron.frozen ? true : undefined,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  }
}

/**
 * Converts the neuron to an internal JSON format with index.
 * Issue #1958: Uses integer neuron IDs instead of UUID strings.
 */
export function internalJSON(
  neuron: Neuron,
  indx: number,
): NeuronInternal {
  if (neuron.type === "input") {
    return {
      type: neuron.type,
      index: indx,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else if (neuron.type === "constant") {
    return {
      type: neuron.type,
      index: indx,
      id: neuron.id,
      bias: neuron.bias,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else {
    return {
      type: neuron.type,
      index: indx,
      id: neuron.id,
      bias: neuron.bias,
      squash: neuron.squash,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  }
}

/**
 * Generates a deterministic runtime integer ID from a UUID string.
 * Used when loading JSON that has UUIDs but no pre-assigned integer IDs.
 * IDs are in the range [1_000_000, 2_000_000_000) to avoid collisions
 * with input neuron IDs (0+) and output neuron IDs (negative).
 */
function deterministicIdFromUuid(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const chr = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  // Ensure positive and in range [1_000_000, 2_000_000_000)
  return 1_000_000 + Math.abs(hash % 1_999_000_000);
}

/**
 * Convert a JSON object to a Neuron instance.
 * Assigns a runtime integer ID from `json.id`, or derives one deterministically
 * from `json.uuid` when no integer ID is present.
 */
export function fromJSON(
  json: NeuronExport | NeuronInternal,
  creature: Creature,
): Neuron {
  let id: number;
  if (json.id !== undefined) {
    id = json.id;
    ensureIdAbove(id);
  } else if (json.uuid) {
    id = deterministicIdFromUuid(json.uuid);
    ensureIdAbove(id);
  } else {
    id = nextNeuronId();
  }

  let uuid: string | undefined;
  if (typeof json.uuid === "string") {
    uuid = json.uuid;
  } else if (
    json.id !== undefined &&
    (json.type === "hidden" || json.type === "constant")
  ) {
    // Legacy snapshots that only stored integer ids: tie a stable label to that id
    // so the same file always re-imports with the same uuid string.
    uuid = `legacy-neuron-${json.id}`;
  }

  const neuron = new Neuron(
    id,
    json.type,
    json.bias ? json.bias : 0,
    creature,
    json.squash,
    uuid,
  );

  if (json.frozen) {
    neuron.frozen = true;
  }

  if (json.tags) {
    addTags(neuron, json);
  }
  return neuron;
}
