/**
 * NeuronSerialization.ts - JSON import/export for neurons.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import { addTags } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { ensureIdAbove, nextNeuronId } from "../architecture/NeuronId.ts";
import type {
  NeuronExport,
  NeuronInternal,
} from "../architecture/NeuronInterfaces.ts";
import { TopologyError } from "../errors/TopologyError.ts";

/**
 * Converts the neuron to a JSON export object.
 * Issue #1958: Uses integer neuron IDs instead of UUID strings.
 */
export function exportJSON(neuron: Neuron): NeuronExport {
  if (neuron.type === "input") {
    throw new TopologyError(
      `Should not be exporting 'input'`,
      "INVALID_NEURON_TYPE",
    );
  } else if (neuron.type === "constant") {
    return {
      type: neuron.type,
      id: neuron.id,
      bias: neuron.bias,
      frozen: neuron.frozen ? true : undefined,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else {
    return {
      type: neuron.type,
      id: neuron.id,
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
 * Generates a deterministic integer ID from a legacy UUID string.
 * Uses a simple hash to ensure the same UUID always produces the same ID.
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
 * Issue #1958: Uses integer neuron IDs instead of UUID strings.
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
    // Legacy format: generate deterministic ID from UUID string
    id = deterministicIdFromUuid(json.uuid);
    ensureIdAbove(id);
  } else {
    id = nextNeuronId();
  }

  const neuron = new Neuron(
    id,
    json.type,
    json.bias ? json.bias : 0,
    creature,
    json.squash,
  );

  if (json.frozen) {
    neuron.frozen = true;
  }

  if (json.tags) {
    addTags(neuron, json);
  }
  return neuron;
}
