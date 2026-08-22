/**
 * MemeticWireExport.ts — the single producer of memetic wire JSON.
 *
 * The canonical wire shape is normative in
 * [`test/fixtures/golden/README.md`](../../test/fixtures/golden/README.md)
 * ("The canonical memetic wire shape"): `weights` is **always** an array of
 * `{ fromUUID, toUUID, weight }` rows — in the top-level snapshot and in every
 * `ancestry[]` snapshot — and the empty value is `[]`, never `{}`, never a
 * missing key. Issue #3816 removed the dual-shape ambiguity that let Issue
 * #3810 through; this module emits that one shape and nothing else.
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

/**
 * Rewrites one memetic snapshot for wire JSON: biases keyed by wire strings;
 * weights as the canonical array of synapse-shaped rows (no numeric neuron
 * keys, and `[]` when there is nothing to record).
 *
 * @param where Dotted path of this snapshot, used in failure messages.
 */
function convertMemeticSnapshotToWireJson(
  node: MemeticWireData,
  idToUuid: Map<number, string>,
  where: string,
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

  // Canonical empty: a snapshot that never had a memetic pass still writes
  // the key, as `[]`.
  if (node.weights === undefined) {
    (node as unknown as Record<string, unknown>).weights = [];
    return;
  }

  // Fail loud rather than emit a shape no engine can read (Issue #3810 is
  // what a non-conforming `weights` costs downstream).
  if (node.weights === null || typeof node.weights !== "object") {
    throw new ValidationError(
      `${where} must be an array of {fromUUID, toUUID, weight} rows` +
        ` — got ${node.weights === null ? "null" : typeof node.weights}`,
      "MEMETIC",
    );
  }

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
 * Deep-clones memetic and converts every snapshot (including ancestry) to the
 * canonical wire JSON. Every snapshot lands on the same `weights` shape — the
 * row array — so one creature never mixes the two shapes.
 *
 * @throws {ValidationError} `MEMETIC` when a snapshot carries a `weights`
 *   value that is neither an array nor a map, or an `ancestry` that is not an
 *   array. Emitting such a creature would break every downstream engine.
 */
export function convertMemeticExportToWireJson(
  creature: Creature,
  memetic: MemeticInterface,
): MemeticInterface {
  const idToUuid = buildNeuronIdToWireUuidMap(creature);
  const raw = JSON.parse(JSON.stringify(memetic)) as MemeticWireData;
  convertMemeticSnapshotToWireJson(raw, idToUuid, "memetic.weights");
  if (raw.ancestry !== undefined) {
    if (!Array.isArray(raw.ancestry)) {
      throw new ValidationError(
        `memetic.ancestry must be an array of snapshots — got ${typeof raw
          .ancestry}`,
        "MEMETIC",
      );
    }
    raw.ancestry.forEach((snap, index) => {
      convertMemeticSnapshotToWireJson(
        snap,
        idToUuid,
        `memetic.ancestry[${index}].weights`,
      );
    });
  }
  return raw as unknown as MemeticInterface;
}
