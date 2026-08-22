/**
 * MemeticWireExport.ts — the single producer of memetic wire JSON.
 *
 * The canonical wire shape is defined normatively in
 * [`test/fixtures/golden/README.md`](../../test/fixtures/golden/README.md)
 * ("The canonical memetic wire shape"): `weights` is **always** an array of
 * `{ fromUUID, toUUID, weight }` rows and `biases` **always** an object keyed
 * by wire identity — in the top-level snapshot and in every `ancestry[]`
 * snapshot alike, with `[]` and `{}` as the only canonical empty values.
 * Issue #3816 removed the dual-shape ambiguity that let Issue #3810 through;
 * this module emits that one shape and nothing else.
 *
 * @module
 */
import type { Creature } from "../Creature.ts";
import type { MemeticInterface } from "../blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "../blackbox/MemeticWireData.ts";
import { ValidationError } from "../errors/ValidationError.ts";
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
 * Rejects a `weights`/`biases` value whose type no engine can read. An absent
 * key is the documented empty case and is filled in; a wrong-typed one is a
 * producer bug, and emitting a shape the Rust and TypeScript readers cannot
 * parse is exactly what Issue #3810 cost — so it fails loud here instead.
 */
function rejectUnreadable(
  value: unknown,
  where: string,
  expected: string,
): never {
  throw new ValidationError(
    `${where} must be ${expected} — got ${
      value === null ? "null" : Array.isArray(value) ? "an array" : typeof value
    }`,
    "MEMETIC",
  );
}

/**
 * Canonical `biases`: a JSON object keyed by wire neuron identity. A runtime
 * integer key is rewritten to its wire string, an absent value becomes the
 * canonical empty map, and any other type fails loud.
 */
function canonicalBiases(
  biases: unknown,
  idToUuid: Map<number, string>,
  where: string,
): Record<string, number> {
  const next: Record<string, number> = {};
  if (biases === undefined) return next;
  if (!isPlainObject(biases)) {
    rejectUnreadable(biases, where, "an object keyed by wire identity");
  }

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
 * the runtime map (`fromId → [{toId, weight}]`) or an already-converted row
 * array; an absent value becomes the canonical empty array, and any other
 * type fails loud rather than being passed through unchanged.
 */
function canonicalWeightRows(
  weights: unknown,
  idToUuid: Map<number, string>,
  where: string,
): MemeticWeightWireRow[] {
  const rows: MemeticWeightWireRow[] = [];
  if (weights === undefined) return rows;

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

  if (!isPlainObject(weights)) {
    rejectUnreadable(
      weights,
      where,
      "an array of {fromUUID, toUUID, weight} rows",
    );
  }

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
 *
 * @param where Dotted path of this snapshot, used in failure messages.
 */
function convertMemeticSnapshotToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
  where: string,
): void {
  const writable = node as unknown as Record<string, unknown>;
  writable.biases = canonicalBiases(node.biases, idToUuid, `${where}.biases`);
  writable.weights = canonicalWeightRows(
    node.weights,
    idToUuid,
    `${where}.weights`,
  );
}

/**
 * Canonicalises a snapshot and every ancestry snapshot beneath it, to any
 * depth, so one creature never mixes the two shapes across its ancestry.
 * Input is a JSON deep clone, so the walk cannot cycle.
 */
function convertMemeticTreeToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
  where: string,
): void {
  convertMemeticSnapshotToWireJson(node, idToUuid, where);
  if (!Array.isArray(node.ancestry)) return;
  let index = 0;
  for (const snap of node.ancestry) {
    const at = `${where}.ancestry[${index++}]`;
    if (!isPlainObject(snap)) {
      rejectUnreadable(snap, at, "a memetic snapshot object");
    }
    convertMemeticTreeToWireJson(snap as MemeticWireData, idToUuid, at);
  }
}

/**
 * Deep-clones memetic and converts every snapshot (including ancestry) to the
 * canonical wire shape.
 *
 * The canonical shape is defined normatively in
 * `test/fixtures/golden/README.md` ("The canonical memetic wire shape"); this
 * function is the only producer of it, and emits nothing else (Issue #3816).
 *
 * @throws ValidationError (`MEMETIC`) when a snapshot carries a `weights` or
 * `biases` value of a type no engine can read, rather than putting it on the
 * wire.
 */
export function convertMemeticExportToWireJson(
  creature: Creature,
  memetic: MemeticInterface,
): MemeticInterface {
  const idToUuid = buildNeuronIdToWireUuidMap(creature);
  const raw = JSON.parse(JSON.stringify(memetic)) as MemeticWireData;
  convertMemeticTreeToWireJson(raw, idToUuid, "memetic");
  return raw as unknown as MemeticInterface;
}
