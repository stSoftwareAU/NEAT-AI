/**
 * WasmTopologyOps.ts — Selective WASM residency for read-heavy topology operations.
 *
 * Issue #1959: Migrates topology validation, connection availability scanning,
 * and neuron dependency analysis to WASM/Rust. These are read-only operations
 * on typed array topology data that benefit from native code execution.
 *
 * Each function tries the WASM implementation first; if WASM is not available,
 * falls back to an equivalent TypeScript implementation.
 */

import type { TypedTopology } from "../architecture/TypedTopology.ts";
import {
  getComputeReverseTopologicalOrderFn,
  getScanAvailableConnectionsFn,
  getValidateTopologyFn,
} from "./WasmModuleLoader.ts";

// ---------------------------------------------------------------------------
// Constants — topology validation error codes (must match Rust topology_ops.rs)
// ---------------------------------------------------------------------------

/** Topology is valid. */
export const TOPOLOGY_VALID = 0;
/** Self-connection detected (from === to). */
export const TOPOLOGY_SELF_CONNECTION = 1;
/** Backward connection detected (from > to). */
export const TOPOLOGY_BACKWARD_CONNECTION = 2;
/** From indices not sorted in non-decreasing order. */
export const TOPOLOGY_SORT_ERROR_FROM = 3;
/** To indices not sorted within the same from group. */
export const TOPOLOGY_SORT_ERROR_TO = 4;
/** Duplicate connection detected. */
export const TOPOLOGY_DUPLICATE_CONNECTION = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a forward-only topology validation. */
export interface TopologyValidationResult {
  /** Whether the topology is valid. */
  valid: boolean;
  /** Error code (0 = valid, see TOPOLOGY_* constants). */
  errorCode: number;
  /** Index of the synapse where the error was found (0 if valid). */
  synapseIndex: number;
}

// ===========================================================================
// 1. Topology Validation (Forward-Only Checks)
// ===========================================================================

/**
 * Validate synapse ordering and forward-only constraints.
 * Uses WASM when available, falls back to TypeScript.
 */
export function validateTopology(
  topology: TypedTopology,
): TopologyValidationResult {
  const wasmFn = getValidateTopologyFn();
  if (wasmFn) {
    const result = wasmFn(topology.fromIndices, topology.toIndices);
    return {
      valid: result[0] === TOPOLOGY_VALID,
      errorCode: result[0],
      synapseIndex: result[1],
    };
  }
  return validateTopologyTS(topology.fromIndices, topology.toIndices);
}

/**
 * TypeScript fallback for topology validation.
 * Validates synapse sort order, self-connections, and backward connections.
 */
export function validateTopologyTS(
  fromIndices: Uint32Array,
  toIndices: Uint32Array,
): TopologyValidationResult {
  const len = fromIndices.length;

  let lastFrom = -1;
  let lastTo = -1;

  for (let i = 0; i < len; i++) {
    const from = fromIndices[i];
    const to = toIndices[i];

    // Self-connection check
    if (from === to) {
      return {
        valid: false,
        errorCode: TOPOLOGY_SELF_CONNECTION,
        synapseIndex: i,
      };
    }

    // Backward connection check
    if (from > to) {
      return {
        valid: false,
        errorCode: TOPOLOGY_BACKWARD_CONNECTION,
        synapseIndex: i,
      };
    }

    // Sort order: from indices must be non-decreasing
    if (from < lastFrom) {
      return {
        valid: false,
        errorCode: TOPOLOGY_SORT_ERROR_FROM,
        synapseIndex: i,
      };
    } else if (from > lastFrom) {
      lastTo = -1;
    }

    // Within same from, to indices must be strictly increasing
    if (from === lastFrom) {
      if (to < lastTo) {
        return {
          valid: false,
          errorCode: TOPOLOGY_SORT_ERROR_TO,
          synapseIndex: i,
        };
      } else if (to === lastTo) {
        return {
          valid: false,
          errorCode: TOPOLOGY_DUPLICATE_CONNECTION,
          synapseIndex: i,
        };
      }
    }

    lastFrom = from;
    lastTo = to;
  }

  return { valid: true, errorCode: TOPOLOGY_VALID, synapseIndex: 0 };
}

// ===========================================================================
// 2. Connection Availability Scanning
// ===========================================================================

/**
 * Scan for available forward-only connection slots.
 * Uses WASM when available, falls back to TypeScript.
 */
export function scanAvailableConnections(
  topology: TypedTopology,
): [number, number][] {
  const wasmFn = getScanAvailableConnectionsFn();
  if (wasmFn) {
    const flat = wasmFn(
      topology.fromIndices,
      topology.toIndices,
      topology.isConstant,
      topology.numNeurons,
      topology.numInputs,
    );
    // Convert flat [from, to, from, to, ...] to pairs
    const result: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) {
      result.push([flat[i], flat[i + 1]]);
    }
    return result;
  }
  return scanAvailableConnectionsTS(
    topology.fromIndices,
    topology.toIndices,
    topology.isConstant,
    topology.numNeurons,
    topology.numInputs,
  );
}

/**
 * TypeScript fallback for available connection scanning.
 */
export function scanAvailableConnectionsTS(
  fromIndices: Uint32Array,
  toIndices: Uint32Array,
  isConstant: Uint8Array,
  numNeurons: number,
  numInputs: number,
): [number, number][] {
  // Build connection set for O(1) lookup
  const connSet = new Set<number>();
  for (let i = 0; i < fromIndices.length; i++) {
    connSet.add(fromIndices[i] * numNeurons + toIndices[i]);
  }

  const available: [number, number][] = [];

  for (let fromIdx = 0; fromIdx < numNeurons; fromIdx++) {
    const startTo = Math.max(fromIdx + 1, numInputs);
    for (let toIdx = startTo; toIdx < numNeurons; toIdx++) {
      if (isConstant[toIdx] === 1) continue;
      const key = fromIdx * numNeurons + toIdx;
      if (!connSet.has(key)) {
        available.push([fromIdx, toIdx]);
      }
    }
  }

  return available;
}

// ===========================================================================
// 3. Neuron Dependency Analysis (Reverse Topological Order)
// ===========================================================================

/**
 * Compute reverse topological order for backpropagation.
 * Uses WASM when available, falls back to TypeScript.
 */
export function computeReverseTopologicalOrder(
  topology: TypedTopology,
): number[] {
  const wasmFn = getComputeReverseTopologicalOrderFn();
  if (wasmFn) {
    const result = wasmFn(
      topology.fromIndices,
      topology.toIndices,
      topology.numNeurons,
      topology.numInputs,
    );
    return Array.from(result);
  }
  return computeReverseTopologicalOrderTS(
    topology.fromIndices,
    topology.toIndices,
    topology.numNeurons,
    topology.numInputs,
  );
}

/**
 * TypeScript fallback for reverse topological order computation.
 * Uses Kahn's algorithm on the forward connection graph.
 */
export function computeReverseTopologicalOrderTS(
  fromIndices: Uint32Array,
  toIndices: Uint32Array,
  numNeurons: number,
  numInputs: number,
): number[] {
  // Count outgoing forward edges for each non-input neuron
  const outDegree = new Int32Array(numNeurons);

  for (let i = 0; i < fromIndices.length; i++) {
    const from = fromIndices[i];
    const to = toIndices[i];
    if (from === to) continue; // Skip self-loops
    if (from >= numInputs) {
      outDegree[from]++;
    }
  }

  // Build inward adjacency: for each neuron, which sources feed into it
  const inward: number[][] = new Array(numNeurons);
  for (let i = 0; i < numNeurons; i++) {
    inward[i] = [];
  }
  for (let i = 0; i < fromIndices.length; i++) {
    inward[toIndices[i]].push(fromIndices[i]);
  }

  // Start with neurons that have no outgoing forward edges
  const queue: number[] = [];
  for (let i = numInputs; i < numNeurons; i++) {
    if (outDegree[i] === 0) {
      queue.push(i);
    }
  }

  const result: number[] = [];
  const visited = new Uint8Array(numNeurons);
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    if (visited[idx]) continue;
    visited[idx] = 1;
    result.push(idx);

    for (const from of inward[idx]) {
      if (from === idx) continue; // Skip self-loops
      if (from < numInputs) continue; // Skip input neurons
      if (visited[from]) continue;

      outDegree[from]--;
      if (outDegree[from] <= 0) {
        queue.push(from);
      }
    }
  }

  // Handle remaining neurons in cycles
  for (let i = numInputs; i < numNeurons; i++) {
    if (!visited[i]) {
      result.push(i);
    }
  }

  return result;
}
