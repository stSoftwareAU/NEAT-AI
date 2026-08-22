/**
 * MemeticWireData.ts - Wire-format interface for memetic data at
 * serialisation boundaries.
 *
 * Issue #2217: Replaces `any` casts when handling memetic data that
 * arrives from or is destined for JSON. The wire format uses UUID
 * string keys (not runtime integer IDs).
 *
 * **The canonical wire shape is normative in
 * [`test/fixtures/golden/README.md`](../../test/fixtures/golden/README.md)**
 * ("The canonical memetic wire shape"): `weights` is an array of
 * `{ fromUUID, toUUID, weight }` rows, empty as `[]`. This interface is the
 * *reader's* view, so it still admits the legacy map for creature JSON
 * already on disk — see `weights` below (Issue #3816).
 */

import type { MemeticWeightWireRow } from "@creature/MemeticWireExport.ts";

/**
 * A single weight entry in the legacy map format.
 * May carry `toId` (runtime integer) or `toUUID` (wire string).
 *
 * Read-only: nothing in this repository emits this shape (Issue #3816).
 */
export interface MemeticWeightEntryWire {
  toId?: number;
  toUUID?: string;
  weight: number;
}

/**
 * Wire-format memetic data as it appears in JSON that crosses process
 * boundaries. Biases are keyed by UUID strings or numeric-string IDs;
 * weights are an array of `MemeticWeightWireRow` on anything this repository
 * writes, and may additionally be a legacy map on anything it reads.
 */
export interface MemeticWireData {
  generation?: number;
  score?: number;

  /** Bias values keyed by wire UUID or numeric-string neuron ID. */
  biases?: Record<string, number>;

  /**
   * Weight data:
   * - **Canonical** — an array of `{ fromUUID, toUUID, weight }` rows, `[]`
   *   when empty. The only shape `convertMemeticExportToWireJson` emits, and
   *   the only shape a new file may carry.
   * - **Legacy, import only** — a map keyed by UUID/numeric-string from-neuron
   *   to arrays of entries. Accepted indefinitely for creature JSON already
   *   saved to disk (Issue #3816); never produced.
   */
  weights?: MemeticWeightWireRow[] | Record<string, MemeticWeightEntryWire[]>;

  /** Ancestor snapshots, ordered from most recent to oldest. */
  ancestry?: MemeticWireData[];
}

/**
 * Runtime validation: returns true when the value looks like a
 * `MemeticWireData` object (has the expected shape at the top level).
 */
export function isMemeticWireData(
  value: unknown,
): value is MemeticWireData {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;

  // biases, if present, must be an object (not an array)
  if (obj.biases !== undefined) {
    if (
      typeof obj.biases !== "object" || obj.biases === null ||
      Array.isArray(obj.biases)
    ) {
      return false;
    }
  }

  // weights, if present, must be an array or object
  if (obj.weights !== undefined) {
    if (typeof obj.weights !== "object" || obj.weights === null) {
      return false;
    }
  }

  // ancestry, if present, must be an array
  if (obj.ancestry !== undefined && !Array.isArray(obj.ancestry)) {
    return false;
  }

  return true;
}
