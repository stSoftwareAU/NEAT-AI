/**
 * WasmTopologyOps.ts — WASM bridge for read-heavy topology operations.
 *
 * Issue #1959/#1961 introduced these helpers as a thin TypeScript bridge over
 * the Rust topology operations exported by NEAT-AI-core (see
 * `neat-core/src/topology_ops.rs`). The WASM bundle is mandatory at runtime,
 * so each function calls straight into the Rust implementation.
 *
 * Issue #2415: The previous pure-TS fallbacks (`*TS` exports) were removed
 * once core stabilised. The shared `TOPOLOGY_*` / `STRUCTURAL_*` constants
 * remain alongside the WASM-backed exports.
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

/** Throws a clear error when the WASM topology bundle is unavailable. */
function requireWasm<T>(fn: T | null | undefined, name: string): T {
  if (!fn) {
    throw new Error(
      `WasmTopologyOps.${name} requires the NEAT-AI-core WASM bundle, ` +
        `but it could not be loaded. Run ./build.sh to refresh ` +
        `wasm_activation/pkg from the pinned core revision.`,
    );
  }
  return fn;
}

// ===========================================================================
// 1. Topology Validation (Forward-Only Checks)
// ===========================================================================

/**
 * Validate synapse ordering and forward-only constraints via WASM.
 */
export function validateTopology(
  topology: TypedTopology,
): TopologyValidationResult {
  const wasmFn = requireWasm(getValidateTopologyFn(), "validateTopology");
  const result = wasmFn(topology.fromIndices, topology.toIndices);
  return {
    valid: result[0] === TOPOLOGY_VALID,
    errorCode: result[0],
    synapseIndex: result[1],
  };
}

// ===========================================================================
// 2. Connection Availability Scanning
// ===========================================================================

/**
 * Scan for available forward-only connection slots via WASM.
 */
export function scanAvailableConnections(
  topology: TypedTopology,
): [number, number][] {
  const wasmFn = requireWasm(
    getScanAvailableConnectionsFn(),
    "scanAvailableConnections",
  );
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

// ===========================================================================
// 3. Neuron Dependency Analysis (Reverse Topological Order)
// ===========================================================================

/**
 * Compute reverse topological order for backpropagation via WASM.
 */
export function computeReverseTopologicalOrder(
  topology: TypedTopology,
): number[] {
  const wasmFn = requireWasm(
    getComputeReverseTopologicalOrderFn(),
    "computeReverseTopologicalOrder",
  );
  const result = wasmFn(
    topology.fromIndices,
    topology.toIndices,
    topology.numNeurons,
    topology.numInputs,
  );
  return Array.from(result);
}

// ===========================================================================
// 4. Structural Integrity Validation (Issue #1961)
// ===========================================================================

/**
 * Validate structural integrity of a typed topology via WASM.
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
  const wasmFn = requireWasm(
    getValidateStructuralIntegrityFn(),
    "validateStructuralIntegrity",
  );
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

// ===========================================================================
// 5. Cycle Detection (Issue #1961)
// ===========================================================================

/**
 * Detect whether the topology contains cycles among non-input neurons via WASM.
 *
 * A topology has a cycle if Kahn's algorithm cannot process all non-input
 * neurons — the remaining neurons form at least one cycle.
 */
export function detectCycles(topology: TypedTopology): boolean {
  const wasmFn = requireWasm(getDetectCyclesFn(), "detectCycles");
  return wasmFn(
    topology.fromIndices,
    topology.toIndices,
    topology.numNeurons,
    topology.numInputs,
  ) !== 0;
}
