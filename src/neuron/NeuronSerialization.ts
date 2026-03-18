/**
 * NeuronSerialization.ts - JSON import/export for neurons.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import { addTags } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import { Neuron } from "../architecture/Neuron.ts";
import type {
  NeuronExport,
  NeuronInternal,
} from "../architecture/NeuronInterfaces.ts";
import { TopologyError } from "../errors/TopologyError.ts";

/**
 * Converts the neuron to a JSON export object.
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
      uuid: neuron.uuid,
      bias: neuron.bias,
      frozen: neuron.frozen ? true : undefined,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else {
    return {
      type: neuron.type,
      uuid: neuron.uuid,
      bias: neuron.bias,
      squash: neuron.squash,
      frozen: neuron.frozen ? true : undefined,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  }
}

/**
 * Converts the neuron to an internal JSON format with index.
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
      uuid: neuron.uuid,
      bias: neuron.bias,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  } else {
    return {
      type: neuron.type,
      index: indx,
      uuid: neuron.uuid,
      bias: neuron.bias,
      squash: neuron.squash,
      tags: neuron.tags ? [...neuron.tags] : undefined,
    };
  }
}

/**
 * Convert a JSON object to a Neuron instance.
 */
export function fromJSON(
  json: NeuronExport | NeuronInternal,
  creature: Creature,
): Neuron {
  const neuron = new Neuron(
    json.uuid ? json.uuid : crypto.randomUUID(),
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
