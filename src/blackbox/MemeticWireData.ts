/**
 * MemeticWireData.ts - Wire-format interface for memetic data at
 * serialisation boundaries.
 *
 * Issue #2217: Replaces `any` casts when handling memetic data that
 * arrives from or is destined for JSON. The wire format uses UUID
 * string keys, never runtime integer IDs.
 *
 * **The canonical wire shape is defined normatively in
 * `test/fixtures/golden/README.md` ("The canonical memetic wire shape") —
 * `weights` is an array of `{ fromUUID, toUUID, weight }` rows (`[]` when
 * empty) and `biases` is an object keyed by wire identity, in the top-level
 * snapshot and in every `ancestry[]` snapshot alike.**
 *
 * This interface is deliberately wider than that: it is the **read** type,
 * and reading is more permissive than writing (Issue #3816). The legacy map
 * arm of `weights` exists for creature JSON already saved to disk and is
 * accepted indefinitely on import; `convertMemeticExportToWireJson`
 * (`@creature/MemeticWireExport.ts`) is the only producer and emits the
 * canonical shape only.
 */

import type { MemeticWeightWireRow } from "@creature/MemeticWireExport.ts";

/**
 * A single weight entry in the legacy map format.
 * May carry `toId` (runtime integer) or `toUUID` (wire string).
 *
 * Import-only (Issue #3816): never emitted by the export path.
 */
export interface MemeticWeightEntryWire {
  toId?: number;
  toUUID?: string;
  weight: number;
}

/**
 * Wire-format memetic data as it appears in JSON that crosses process
 * boundaries — the **read** type, so it admits the legacy shapes an old
 * creature file may still carry. See the module comment for where the single
 * canonical **write** shape is defined.
 */
export interface MemeticWireData {
  generation?: number;
  score?: number;

  /** Bias values keyed by wire UUID or numeric-string neuron ID. */
  biases?: Record<string, number>;

  /**
   * Weight data in one of two formats:
   * - **Canonical**: array of `{ fromUUID, toUUID, weight }` rows — the only
   *   shape the export path emits, `[]` when empty.
   * - **Legacy, import-only**: map keyed by UUID/numeric-string from-neuron to
   *   arrays of entries. Accepted indefinitely for creature JSON already on
   *   disk (Issue #3816); never produced.
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
