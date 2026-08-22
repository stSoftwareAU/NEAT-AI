import type { Creature } from "../Creature.ts";
import type { MemeticInterface } from "../blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "../blackbox/MemeticWireData.ts";
import { neuronUuid } from "../neuron/NeuronSerialization.ts";

/**
 * Runtime neuron id → canonical wire string (input-N, output-N, or neuron.uuid).
 * Used when serialising memetic state for any JSON that leaves the process.
 */
function buildNeuronIdToWireUuidMap(
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

/** True for a plain JSON object — not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical `biases`: a JSON object keyed by wire neuron identity. A runtime
 * integer key is rewritten to its wire string; anything that is not a plain
 * object (absent, null, or a stray array) becomes the canonical empty map.
 */
function canonicalBiases(
  biases: unknown,
  idToUuid: Map<number, string>,
): Record<string, number> {
  const next: Record<string, number> = {};
  if (!isPlainObject(biases)) return next;

  for (const k of Object.keys(biases)) {
    const value = biases[k];
    if (typeof value !== "number") continue;
    const asNum = Number(k);
    const wireKey = Number.isFinite(asNum) && `${asNum}` === k
      ? idToUuid.get(asNum)
      : undefined;
    next[wireKey ?? k] = value;
  }
  return next;
}

/**
 * Canonical `weights`: an array of `{fromUUID, toUUID, weight}` rows. Accepts
 * the runtime map (`fromId → [{toId, weight}]`), an already-converted row
 * array, or nothing at all — an absent, null, or unrecognised value becomes
 * the canonical empty array rather than being passed through unchanged.
 */
function canonicalWeightRows(
  weights: unknown,
  idToUuid: Map<number, string>,
): MemeticWeightWireRow[] {
  const rows: MemeticWeightWireRow[] = [];

  if (Array.isArray(weights)) {
    for (const e of weights) {
      if (!isPlainObject(e) || typeof e.weight !== "number") continue;
      if (typeof e.fromUUID !== "string" || typeof e.toUUID !== "string") {
        continue;
      }
      rows.push({ fromUUID: e.fromUUID, toUUID: e.toUUID, weight: e.weight });
    }
    return rows;
  }

  if (!isPlainObject(weights)) return rows;

  for (const k of Object.keys(weights)) {
    const asNum = Number(k);
    const fromKey = Number.isFinite(asNum) && `${asNum}` === k
      ? idToUuid.get(asNum)
      : k;
    if (typeof fromKey !== "string") continue;

    const arr = weights[k];
    if (!Array.isArray(arr)) continue;

    for (const e of arr) {
      if (!isPlainObject(e) || typeof e.weight !== "number") continue;
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
  return rows;
}

/**
 * Rewrites one memetic snapshot into the canonical wire shape (Issue #3816):
 * `weights` always an array of `{fromUUID, toUUID, weight}` rows — `[]` when
 * there is nothing to record — and `biases` always an object keyed by wire
 * identity. Both keys are written unconditionally, so no snapshot can leave
 * this function carrying a map where a row array is expected, a bare array
 * where a map is expected, or a missing key.
 */
function convertMemeticSnapshotToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
): void {
  const writable = node as unknown as Record<string, unknown>;
  writable.biases = canonicalBiases(node.biases, idToUuid);
  writable.weights = canonicalWeightRows(node.weights, idToUuid);
}

/**
 * Canonicalises a snapshot and every ancestry snapshot beneath it, to any
 * depth, so one creature never mixes the two shapes across its ancestry.
 * Input is a JSON deep clone, so the walk cannot cycle.
 */
function convertMemeticTreeToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
): void {
  convertMemeticSnapshotToWireJson(node, idToUuid);
  if (!Array.isArray(node.ancestry)) return;
  for (const snap of node.ancestry) {
    if (isPlainObject(snap)) {
      convertMemeticTreeToWireJson(snap as MemeticWireData, idToUuid);
    }
  }
}

/**
 * Deep-clones memetic and converts every snapshot (including ancestry) to the
 * canonical wire shape.
 *
 * The canonical shape is defined normatively in
 * `test/fixtures/golden/README.md` ("The canonical memetic wire shape"); this
 * function is the only producer of it, and emits nothing else (Issue #3816).
 */
export function convertMemeticExportToWireJson(
  creature: Creature,
  memetic: MemeticInterface,
): MemeticInterface {
  const idToUuid = buildNeuronIdToWireUuidMap(creature);
  const raw = JSON.parse(JSON.stringify(memetic)) as MemeticWireData;
  convertMemeticTreeToWireJson(raw, idToUuid);
  return raw as unknown as MemeticInterface;
}
