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

import type { TypedTopology } from "@architecture/TypedTopology.ts";
import {
  getComputeReverseTopologicalOrderFn,
  getDetectCyclesFn,
  getScanAvailableConnectionsFn,
  getValidateStructuralIntegrityFn,
  getValidateTopologyFn,
} from "@wasm/WasmModuleLoader.ts";

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
// Constants — structural integrity error codes (must match Rust topology_ops.rs)
// Issue #1961
// ---------------------------------------------------------------------------

/** Structural integrity is valid. */
export const STRUCTURAL_VALID = 0;
/** A synapse targets an input neuron. */
export const STRUCTURAL_SYNAPSE_TARGETS_INPUT = 1;
/** A constant neuron has inward connections. */
export const STRUCTURAL_CONSTANT_HAS_INWARD = 2;
/** A hidden neuron has no inward connections. */
export const STRUCTURAL_HIDDEN_NO_INWARD = 3;
/** A hidden neuron has no outward connections. */
export const STRUCTURAL_HIDDEN_NO_OUTWARD = 4;
/** A non-input neuron has a non-finite bias. */
export const STRUCTURAL_BIAS_NOT_FINITE = 5;
/** An IF neuron has fewer than 3 inward connections. */
export const STRUCTURAL_IF_TOO_FEW_INWARD = 6;
/** An IF neuron is missing a condition synapse. */
export const STRUCTURAL_IF_MISSING_CONDITION = 7;
/** An IF neuron is missing a positive synapse. */
export const STRUCTURAL_IF_MISSING_POSITIVE = 8;
/** An IF neuron is missing a negative synapse. */
export const STRUCTURAL_IF_MISSING_NEGATIVE = 9;

/** Squash type code for IF (must match SquashType enum). */
const IF_SQUASH_TYPE = 34;
/** Synapse type codes (must match SynapseTypeCode enum). */
const SYNAPSE_CONDITION = 1;
const SYNAPSE_NEGATIVE = 2;
const SYNAPSE_POSITIVE = 3;
const SYNAPSE_STANDARD = 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of structural integrity validation. Issue #1961. */
export interface StructuralValidationResult {
  /** Whether the structure is valid. */
  valid: boolean;
  /** Error code (0 = valid, see STRUCTURAL_* constants). */
  errorCode: number;
  /** Index of the neuron or synapse where the error was found (0 if valid). */
  neuronIndex: number;
}

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

// ===========================================================================
// 4. Structural Integrity Validation (Issue #1961)
// ===========================================================================

/**
 * Validate structural integrity of a typed topology.
 * Uses WASM when available, falls back to TypeScript.
 *
 * Checks:
 * - No synapse targets an input neuron
 * - Constant neurons have no inward connections
 * - Hidden neurons have at least 1 inward and 1 outward connection
 * - Non-input neuron biases are finite
 * - IF neurons have at least 3 inward connections with
 *   condition, positive, and negative synapse types
 */
export function validateStructuralIntegrity(
  topology: TypedTopology,
): StructuralValidationResult {
  const wasmFn = getValidateStructuralIntegrityFn();
  if (wasmFn) {
    const result = wasmFn(
      topology.fromIndices,
      topology.toIndices,
      topology.isConstant,
      topology.squashTypes,
      topology.biases,
      topology.numInputs,
      topology.numOutputs,
      topology.synapseTypes,
    );
    return {
      valid: result[0] === STRUCTURAL_VALID,
      errorCode: result[0],
      neuronIndex: result[1],
    };
  }
  return validateStructuralIntegrityTS(
    topology.fromIndices,
    topology.toIndices,
    topology.isConstant,
    topology.squashTypes,
    topology.biases,
    topology.numInputs,
    topology.numOutputs,
    topology.synapseTypes,
  );
}

/**
 * TypeScript fallback for structural integrity validation.
 * Issue #1961.
 */
export function validateStructuralIntegrityTS(
  fromIndices: Uint32Array,
  toIndices: Uint32Array,
  isConstant: Uint8Array,
  squashTypes: Uint8Array,
  biases: Float64Array,
  numInputs: number,
  numOutputs: number,
  synapseTypes?: Uint8Array,
): StructuralValidationResult {
  const numNeurons = biases.length;
  const numSynapses = fromIndices.length;

  // Check no synapse targets an input neuron
  for (let i = 0; i < numSynapses; i++) {
    if (toIndices[i] < numInputs) {
      return {
        valid: false,
        errorCode: STRUCTURAL_SYNAPSE_TARGETS_INPUT,
        neuronIndex: toIndices[i],
      };
    }
  }

  // Count inward and outward connections per non-input neuron
  const inwardCount = new Uint32Array(numNeurons);
  const outwardCount = new Uint32Array(numNeurons);

  for (let i = 0; i < numSynapses; i++) {
    outwardCount[fromIndices[i]]++;
    inwardCount[toIndices[i]]++;
  }

  // Validate each non-input neuron
  const hiddenStart = numInputs;
  const outputStart = numNeurons - numOutputs;

  for (let i = hiddenStart; i < numNeurons; i++) {
    const isOutput = i >= outputStart;
    const isConst = isConstant[i] === 1;

    // Check bias is finite for non-input neurons
    if (!isConst) {
      const bias = biases[i];
      if (!Number.isFinite(bias)) {
        return {
          valid: false,
          errorCode: STRUCTURAL_BIAS_NOT_FINITE,
          neuronIndex: i,
        };
      }
    }

    // Constant neuron checks
    if (isConst) {
      if (inwardCount[i] > 0) {
        return {
          valid: false,
          errorCode: STRUCTURAL_CONSTANT_HAS_INWARD,
          neuronIndex: i,
        };
      }
      continue;
    }

    // Hidden neuron checks (not output, not constant)
    if (!isOutput) {
      if (inwardCount[i] === 0) {
        return {
          valid: false,
          errorCode: STRUCTURAL_HIDDEN_NO_INWARD,
          neuronIndex: i,
        };
      }
      if (outwardCount[i] === 0) {
        return {
          valid: false,
          errorCode: STRUCTURAL_HIDDEN_NO_OUTWARD,
          neuronIndex: i,
        };
      }
    }

    // IF neuron validation
    if (squashTypes[i] === IF_SQUASH_TYPE) {
      if (inwardCount[i] < 3) {
        return {
          valid: false,
          errorCode: STRUCTURAL_IF_TOO_FEW_INWARD,
          neuronIndex: i,
        };
      }

      // Check for required synapse types among inward connections
      if (synapseTypes) {
        let hasCondition = false;
        let hasPositive = false;
        let hasNegative = false;

        for (let s = 0; s < numSynapses; s++) {
          if (toIndices[s] !== i) continue;
          const st = synapseTypes[s];
          if (st === SYNAPSE_CONDITION) hasCondition = true;
          if (st === SYNAPSE_POSITIVE || st === SYNAPSE_STANDARD) {
            hasPositive = true;
          }
          if (st === SYNAPSE_NEGATIVE) hasNegative = true;
        }

        if (!hasCondition) {
          return {
            valid: false,
            errorCode: STRUCTURAL_IF_MISSING_CONDITION,
            neuronIndex: i,
          };
        }
        if (!hasPositive) {
          return {
            valid: false,
            errorCode: STRUCTURAL_IF_MISSING_POSITIVE,
            neuronIndex: i,
          };
        }
        if (!hasNegative) {
          return {
            valid: false,
            errorCode: STRUCTURAL_IF_MISSING_NEGATIVE,
            neuronIndex: i,
          };
        }
      }
    }
  }

  return { valid: true, errorCode: STRUCTURAL_VALID, neuronIndex: 0 };
}

// ===========================================================================
// 5. Cycle Detection (Issue #1961)
// ===========================================================================

/**
 * Detect whether the topology contains cycles among non-input neurons.
 * Uses WASM when available, falls back to TypeScript.
 *
 * A topology has a cycle if Kahn's algorithm cannot process all non-input
 * neurons — the remaining neurons form at least one cycle.
 */
export function detectCycles(topology: TypedTopology): boolean {
  const wasmFn = getDetectCyclesFn();
  if (wasmFn) {
    return wasmFn(
      topology.fromIndices,
      topology.toIndices,
      topology.numNeurons,
      topology.numInputs,
    ) !== 0;
  }
  return detectCyclesTS(
    topology.fromIndices,
    topology.toIndices,
    topology.numNeurons,
    topology.numInputs,
  );
}

/**
 * TypeScript fallback for cycle detection using Kahn's algorithm.
 * Issue #1961.
 *
 * Returns true if any cycle exists among non-input neurons.
 */
export function detectCyclesTS(
  fromIndices: Uint32Array,
  toIndices: Uint32Array,
  numNeurons: number,
  numInputs: number,
): boolean {
  // Build in-degree counts for non-input neurons.
  // Only count edges from other non-input neurons — edges from inputs
  // cannot participate in cycles, so they are excluded.
  const inDegree = new Int32Array(numNeurons);

  for (let i = 0; i < fromIndices.length; i++) {
    const from = fromIndices[i];
    const to = toIndices[i];
    if (from === to) continue;
    if (from >= numInputs && to >= numInputs) {
      inDegree[to]++;
    }
  }

  // Start with non-input neurons that have zero in-degree from non-input sources
  const queue: number[] = [];
  for (let i = numInputs; i < numNeurons; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  let processed = 0;
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    processed++;

    // For each outgoing edge from this neuron, decrement target's in-degree
    for (let s = 0; s < fromIndices.length; s++) {
      if (fromIndices[s] !== idx) continue;
      const to = toIndices[s];
      if (to === idx) continue;
      if (to < numInputs) continue;

      inDegree[to]--;
      if (inDegree[to] === 0) {
        queue.push(to);
      }
    }
  }

  // Check for self-loops explicitly
  for (let i = 0; i < fromIndices.length; i++) {
    if (fromIndices[i] === toIndices[i] && fromIndices[i] >= numInputs) {
      return true;
    }
  }

  const nonInputCount = numNeurons - numInputs;
  return processed < nonInputCount;
}
