import type { Creature } from "../Creature.ts";
import type { MemeticInterface } from "../blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "../blackbox/MemeticWireData.ts";
import { neuronUuid } from "../neuron/NeuronSerialization.ts";

/**
 * Runtime neuron id → canonical wire string (input-N, output-N, or neuron.uuid).
 * Used when serialising memetic state for any JSON that leaves the process.
 */
export function buildNeuronIdToWireUuidMap(
  creature: Creature,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const n of creature.neurons) {
    if (n.type === "input") {
      m.set(n.id, `input-${n.index}`);
    } else {
      m.set(n.id, neuronUuid(n));
    }
  }
  return m;
}

export type MemeticWeightWireRow = {
  fromUUID: string;
  toUUID: string;
  weight: number;
};

/**
 * Rewrites one memetic snapshot for wire JSON: biases keyed by wire strings;
 * weights as an array of synapse-shaped rows (no numeric neuron keys).
 *
 * Module-private: only `convertMemeticExportToWireJson` (below) calls it. It is
 * deliberately not exported — the public wire-conversion entry point is
 * `convertMemeticExportToWireJson`, which handles the root snapshot and every
 * ancestry snapshot (Issue #3315).
 */
function convertMemeticSnapshotToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
): void {
  if (
    node.biases && typeof node.biases === "object" &&
    !Array.isArray(node.biases)
  ) {
    const nextBiases: Record<string, number> = {};
    for (const k of Object.keys(node.biases)) {
      const asNum = Number(k);
      const wireKey = Number.isFinite(asNum) && `${asNum}` === k
        ? idToUuid.get(asNum)
        : undefined;
      if (wireKey) {
        nextBiases[wireKey] = node.biases[k];
      } else {
        nextBiases[k] = node.biases[k];
      }
    }
    node.biases = nextBiases;
  }

  if (!node.weights || typeof node.weights !== "object") return;

  const rows: MemeticWeightWireRow[] = [];

  if (Array.isArray(node.weights)) {
    for (const e of node.weights) {
      if (e === null || e === undefined || typeof e.weight !== "number") {
        continue;
      }
      let fromU: string | undefined;
      let toU: string | undefined;
      if (typeof e.fromUUID === "string" && typeof e.toUUID === "string") {
        fromU = e.fromUUID;
        toU = e.toUUID;
      }
      if (fromU && toU) {
        rows.push({ fromUUID: fromU, toUUID: toU, weight: e.weight });
      }
    }
    (node as unknown as Record<string, unknown>).weights = rows;
    return;
  }

  const weightMap = node.weights as Record<
    string,
    Array<
      { weight?: number; fromUUID?: string; toUUID?: string; toId?: number }
    >
  >;
  for (const k of Object.keys(weightMap)) {
    const asNum = Number(k);
    const fromKey = Number.isFinite(asNum) && `${asNum}` === k
      ? idToUuid.get(asNum)
      : k;
    if (typeof fromKey !== "string") continue;

    const arr = weightMap[k];
    if (!Array.isArray(arr)) continue;

    for (const e of arr) {
      if (e === null || e === undefined || typeof e.weight !== "number") {
        continue;
      }
      let toU: string | undefined;
      if (typeof e.toUUID === "string") {
        toU = e.toUUID;
      } else if (typeof e.toId === "number") {
        toU = idToUuid.get(e.toId);
      }
      if (!toU) continue;
      rows.push({ fromUUID: fromKey, toUUID: toU, weight: e.weight });
    }
  }
  (node as unknown as Record<string, unknown>).weights = rows;
}

/**
 * Deep-clones memetic and converts every snapshot (including ancestry) to wire JSON.
 */
export function convertMemeticExportToWireJson(
  creature: Creature,
  memetic: MemeticInterface,
): MemeticInterface {
  const idToUuid = buildNeuronIdToWireUuidMap(creature);
  const raw = JSON.parse(JSON.stringify(memetic)) as MemeticWireData;
  convertMemeticSnapshotToWireJson(raw, idToUuid);
  if (Array.isArray(raw.ancestry)) {
    for (const snap of raw.ancestry) {
      convertMemeticSnapshotToWireJson(snap, idToUuid);
    }
  }
  return raw as unknown as MemeticInterface;
}
