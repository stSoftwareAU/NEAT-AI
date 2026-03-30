/**
 * NormaliseCreatureExport.ts - Backward-compatible normalisation for legacy
 * CreatureExport objects.
 *
 * Issue #1958: The integer neuron ID migration replaced UUID strings with
 * integer IDs. CreatureExport supports both formats for backward
 * compatibility. This utility ensures `id`, `fromId`, and `toId` fields
 * are populated so that all downstream functions can use integer IDs
 * consistently.
 *
 * When a CreatureExport already has integer IDs, this is a no-op.
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { ensureIdAbove, outputNeuronId } from "@architecture/NeuronId.ts";

/**
 * Deterministic integer ID from a UUID string.
 * Duplicated from NeuronSerialization.ts to avoid circular imports.
 * Must produce the same values as the original.
 */
function deterministicIdFromUuid(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const chr = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return 1_000_000 + Math.abs(hash % 1_999_000_000);
}

function isResolvedIds(json: CreatureExport): boolean {
  for (let i = 0; i < json.synapses.length; i++) {
    const s = json.synapses[i];
    if (s.fromId === undefined || s.toId === undefined) return false;
  }
  for (let i = 0; i < json.neurons.length; i++) {
    const n = json.neurons[i];
    if ((n as { id?: number }).id === undefined) return false;
  }
  return true;
}

/**
 * Ensures every neuron has an `id` field and every synapse has
 * `fromId` / `toId` fields.
 *
 * Mutates the input object in place. Safe to call multiple times
 * (idempotent).
 *
 * @param json - A CreatureExport that uses UUID fields for neuron/synapse identity
 */
export function normaliseCreatureExport(json: CreatureExport): void {
  // Round-trip from exportJSON (no memetic): ids already attached in builder — skip.
  if (!json.memetic && isResolvedIds(json)) {
    return;
  }

  // Build UUID → integer ID mapping
  const uuidToId = new Map<string, number>();
  // Track incorrect numeric IDs that need remapping (e.g. output neurons
  // assigned positive IDs by CRISPR append)
  const idRemap = new Map<number, number>();

  // Pre-populate input neuron mappings
  for (let i = 0; i < json.input; i++) {
    uuidToId.set(`input-${i}`, i);
  }

  // Assign integer IDs to neurons
  let outputIndex = 0;
  for (const neuron of json.neurons) {
    // deno-lint-ignore no-explicit-any
    const rawNeuron = neuron as any;

    if (neuron.type === "output") {
      const correctId = outputNeuronId(outputIndex);
      if (neuron.id !== undefined && neuron.id !== correctId) {
        // Output neuron has wrong ID (e.g. from CRISPR append) — remap
        idRemap.set(neuron.id, correctId);
      }
      (neuron as { id: number }).id = correctId;
      if (rawNeuron.uuid) {
        uuidToId.set(rawNeuron.uuid, correctId);
      }
      outputIndex++;
    } else {
      // Hidden or constant neuron
      if (neuron.id === undefined) {
        if (rawNeuron.uuid) {
          const id = deterministicIdFromUuid(rawNeuron.uuid);
          (neuron as { id: number }).id = id;
          ensureIdAbove(id);
        }
      }
      if (rawNeuron.uuid) {
        uuidToId.set(rawNeuron.uuid, neuron.id!);
      }
    }
  }

  // Assign fromId / toId to synapses
  for (const synapse of json.synapses) {
    // deno-lint-ignore no-explicit-any
    const rawSynapse = synapse as any;

    if (synapse.fromId === undefined && rawSynapse.fromUUID) {
      const id = uuidToId.get(rawSynapse.fromUUID);
      if (id !== undefined) {
        (synapse as { fromId: number }).fromId = id;
      }
    } else if (synapse.fromId !== undefined && idRemap.has(synapse.fromId)) {
      (synapse as { fromId: number }).fromId = idRemap.get(synapse.fromId)!;
    }
    if (synapse.toId === undefined && rawSynapse.toUUID) {
      const id = uuidToId.get(rawSynapse.toUUID);
      if (id !== undefined) {
        (synapse as { toId: number }).toId = id;
      }
    } else if (synapse.toId !== undefined && idRemap.has(synapse.toId)) {
      (synapse as { toId: number }).toId = idRemap.get(synapse.toId)!;
    }
  }

  // Normalise memetic data: convert string UUID keys to integer IDs
  if (json.memetic) {
    normaliseMemeticData(json.memetic, uuidToId);
  }
}

/**
 * Normalise memetic data by converting string UUID keys to integer IDs.
 * Handles weights, biases, and ancestry snapshots.
 */
function normaliseMemeticData(
  // deno-lint-ignore no-explicit-any
  memetic: any,
  uuidToId: Map<string, number>,
): void {
  if (memetic.weights) {
    if (Array.isArray(memetic.weights)) {
      // deno-lint-ignore no-explicit-any
      const acc: Record<number, any[]> = {};
      for (const row of memetic.weights) {
        if (!row || typeof row !== "object") continue;
        // deno-lint-ignore no-explicit-any
        const r = row as any;
        if (typeof r.fromUUID !== "string" || typeof r.toUUID !== "string") {
          continue;
        }
        const fromId = uuidToId.get(r.fromUUID);
        const toId = uuidToId.get(r.toUUID);
        if (fromId === undefined || toId === undefined) continue;
        if (!acc[fromId]) acc[fromId] = [];
        acc[fromId].push({ toId, weight: r.weight });
      }
      memetic.weights = acc;
    } else {
      memetic.weights = convertMapKeys(memetic.weights, uuidToId);
      // Also convert toUUID → toId in weight entries
      for (const key of Object.keys(memetic.weights)) {
        const entries = memetic.weights[key];
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry.toUUID !== undefined && entry.toId === undefined) {
              const id = uuidToId.get(entry.toUUID);
              if (id !== undefined) entry.toId = id;
            }
          }
        }
      }
    }
  }
  if (memetic.biases) {
    memetic.biases = convertMapKeys(memetic.biases, uuidToId);
  }
  // Normalise ancestry snapshots
  if (Array.isArray(memetic.ancestry)) {
    for (const snapshot of memetic.ancestry) {
      normaliseMemeticData(snapshot, uuidToId);
    }
  }
}

/**
 * Convert string UUID keys in an object to integer ID keys.
 * Returns a new object with converted keys.
 */
function convertMapKeys(
  obj: Record<string, unknown>,
  uuidToId: Map<string, number>,
): Record<number, unknown> {
  const result: Record<number, unknown> = {};
  for (const key of Object.keys(obj)) {
    const numKey = Number(key);
    if (Number.isFinite(numKey)) {
      // Already a numeric key
      result[numKey] = obj[key];
    } else {
      // String UUID key - convert to integer
      const id = uuidToId.get(key);
      if (id !== undefined) {
        result[id] = obj[key];
      }
    }
  }
  return result;
}

/**
 * Convenience wrapper: normalises and returns the same object.
 * Useful for inline usage: `const json = normalised({ ... })`.
 */
export function normalised(json: CreatureExport): CreatureExport {
  normaliseCreatureExport(json);
  return json;
}
