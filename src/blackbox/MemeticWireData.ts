/**
 * MemeticWireData.ts - Wire-format interface for memetic data at
 * serialisation boundaries.
 *
 * Issue #2217: Replaces `any` casts when handling memetic data that
 * arrives from or is destined for JSON. The wire format uses UUID
 * string keys (not runtime integer IDs) and may carry weights as
 * either a flat array of `{ fromUUID, toUUID, weight }` rows or as
 * a map keyed by UUID/numeric strings.
 */

import type { MemeticWeightWireRow } from "@creature/MemeticWireExport.ts";

/**
 * A single weight entry in the legacy map format.
 * May carry `toId` (runtime integer) or `toUUID` (wire string).
 */
export interface MemeticWeightEntryWire {
  toId?: number;
  toUUID?: string;
  weight: number;
}

/**
 * Wire-format memetic data as it appears in JSON that crosses process
 * boundaries. Biases are keyed by UUID strings or numeric-string IDs;
 * weights are either an array of `MemeticWeightWireRow` or a legacy
 * map keyed by UUID/numeric strings.
 */
export interface MemeticWireData {
  generation?: number;
  score?: number;

  /** Bias values keyed by wire UUID or numeric-string neuron ID. */
  biases?: Record<string, number>;

  /**
   * Weight data in one of two formats:
   * - Array of `{ fromUUID, toUUID, weight }` rows (preferred wire format)
   * - Legacy map keyed by UUID/numeric-string from-neuron to arrays of entries
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
