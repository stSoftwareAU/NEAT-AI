import { assert } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { outputNeuronId } from "@architecture/NeuronId.ts";
import type { CrisprInterface } from "@reconstruct/CRISPR.ts";

/**
 * Deterministic integer ID from a UUID string.
 * Duplicated to avoid circular imports. Must produce the same values
 * as NeuronSerialization.deterministicIdFromUuid.
 */
function deterministicIdFromUuid(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const chr = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return 1_000_000 + Math.abs(hash % 1_999_000_000);
}

/**
 * Resolve a UUID string to a runtime integer neuron ID.
 * Handles `input-X`, `output-X`, and arbitrary UUID strings.
 */
function resolveUuid(
  uuid: string,
  neuronUuidMap: Map<string, number>,
): number {
  const inputMatch = uuid.match(/^input-(\d+)$/);
  if (inputMatch) return parseInt(inputMatch[1], 10);

  const outputMatch = uuid.match(/^output-(\d+)$/);
  if (outputMatch) return outputNeuronId(parseInt(outputMatch[1], 10));

  const mapped = neuronUuidMap.get(uuid);
  if (mapped !== undefined) return mapped;

  return deterministicIdFromUuid(uuid);
}

/**
 * Upgrade class providing static methods to correct and apply CRISPR modifications to creatures.
 */
export class Upgrade {
  /**
   * Corrects the input size of a given creature export and returns a new creature with the corrected input size.
   *
   * @param json - The exported creature to be corrected.
   * @param input - The new input size to be applied to the creature.
   * @returns A new Creature instance with the corrected input size.
   * @throws Will throw an error if the input size is not a positive integer or if it attempts to reduce the input size.
   */
  static correct(
    json: CreatureExport,
    input: number,
  ): Creature {
    assert(Number.isInteger(input) && input > 0, `Invalid input size ${input}`);

    const json2 = JSON.parse(JSON.stringify(json));

    const adjIndex = input - json.input;
    assert(adjIndex >= 0, `Can only expand models ${json.input} -> ${input}`);

    json2.input = input;
    const creature = Creature.fromJSON(json2);

    creature.fix();
    creatureValidate(creature);
    return creature;
  }

  /**
   * Cleans and updates legacy CRISPR data to the latest format.
   * Converts legacy node and connection properties to the newer neuron and synapse properties.
   * Ensures the mode is set to "insert" or "append".
   *
   * @param dnaLegacy - The legacy CRISPR data to be cleaned.
   * @returns The cleaned and updated CRISPR data.
   */
  static CRISPR(dnaLegacy: CrisprInterface): CrisprInterface {
    const dnaClean: CrisprInterface = JSON.parse(JSON.stringify(dnaLegacy));

    // Normalise legacy property names (nodes → neurons, connections → synapses).
    const raw = dnaClean as unknown as Record<string, unknown>;
    if (raw.nodes) {
      raw.neurons = raw.nodes;
      delete raw.nodes;
    }
    if (raw.connections) {
      raw.synapses = raw.connections;
      delete raw.connections;
    }

    // Ensure mode is set to "insert" or "append"
    if (dnaClean.mode !== "insert") dnaClean.mode = "append";

    // Resolve UUID fields to runtime integer IDs for internal processing
    const neuronUuidMap = new Map<string, number>();
    if (dnaClean.neurons) {
      for (const neuron of dnaClean.neurons) {
        // deno-lint-ignore no-explicit-any
        const rawN = neuron as any;
        if (typeof rawN.uuid === "string" && neuron.id === undefined) {
          neuron.id = deterministicIdFromUuid(rawN.uuid);
          neuronUuidMap.set(rawN.uuid, neuron.id);
        }
      }
    }
    for (const synapse of dnaClean.synapses) {
      // deno-lint-ignore no-explicit-any
      const rawS = synapse as any;
      if (typeof rawS.fromUUID === "string" && synapse.fromId === undefined) {
        synapse.fromId = resolveUuid(rawS.fromUUID, neuronUuidMap);
      }
      if (typeof rawS.toUUID === "string" && synapse.toId === undefined) {
        synapse.toId = resolveUuid(rawS.toUUID, neuronUuidMap);
      }
    }

    return dnaClean;
  }
}
