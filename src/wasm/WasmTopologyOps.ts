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
import { TopologyError } from "@errors/TopologyError.ts";
import {
  getComputeReverseTopologicalOrderFn,
  getDetectCyclesFn,
  getScanAvailableConnectionsFn,
  getValidateStructuralIntegrityFn,
  getValidateTopologyFn,
  getWasmLoadError,
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
/**
 * Input buffers are malformed — length mismatch between `fromIndices` and
 * `toIndices`, or other defensive bail-out from the Rust hardening landed
 * for NEAT-AI #2659. The TS trap guard `withWasmTrapGuard` still wraps any
 * leftover `RuntimeError` traps, but a Rust-side `MALFORMED_BUFFER` return
 * now reaches callers as a typed result instead of an uncatchable trap.
 */
export const TOPOLOGY_MALFORMED_BUFFER = 6;

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
/**
 * Structural input buffers are malformed — length mismatch between
 * `fromIndices`/`toIndices`, `numInputs`/`numOutputs` larger than
 * `biases.length`, or `numInputs + numOutputs > numNeurons`. Reported by
 * the hardening landed for NEAT-AI #2659 in place of an underflow trap.
 */
export const STRUCTURAL_MALFORMED_BUFFER = 10;

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

/**
 * Throws a clear error when the WASM topology bundle is unavailable.
 *
 * Issue #3230: the previous message only told the caller to "run ./build.sh",
 * which is useless to a project consuming `@stsoftware/neat-ai` from JSR — that
 * consumer cannot rebuild the vendored bundle. Worse, the *real* reason the
 * bundle failed to load (e.g. a Deno `PermissionDenied` net/read error, or a
 * corrupt artefact) was swallowed during auto-init, so the abort surfaced a
 * generic message with no actionable cause.
 *
 * We now surface the underlying load error captured by the loader
 * ({@link getWasmLoadError}) so the failure is loud with its true cause
 * (Issue #3234), and we give guidance for both JSR consumers and local
 * developers. `loadError` defaults to the loader's recorded error but is
 * injectable for testing.
 */
export function requireWasm<T>(
  fn: T | null | undefined,
  name: string,
  loadError: Error | null = getWasmLoadError(),
): T {
  if (!fn) {
    const cause = loadError
      ? `Underlying load error: ${loadError.name}: ${loadError.message}.`
      : `No underlying load error was recorded, so the WASM module was ` +
        `never initialised (auto-init may have been skipped or the process ` +
        `exited before it completed).`;
    const error = new Error(
      `WasmTopologyOps.${name} requires the NEAT-AI-core WASM bundle, ` +
        `but it could not be loaded. ${cause} ` +
        `If you are consuming @stsoftware/neat-ai from JSR, ensure the ` +
        `runtime can load the vendored bundle at wasm_activation/pkg ` +
        `(Deno needs read/net access to the package location to fetch ` +
        `wasm_activation_bg.wasm). If you are developing NEAT-AI locally, ` +
        `run ./build.sh to refresh wasm_activation/pkg from the pinned ` +
        `core revision.`,
      loadError ? { cause: loadError } : undefined,
    );
    throw error;
  }
  return fn;
}

/**
 * Issue #2648: Run a WASM topology call, converting any non-typed trap
 * (e.g. `RuntimeError: memory access out of bounds`, `RuntimeError:
 * unreachable`) into a typed {@link TopologyError} so the breeding /
 * upgrade pipeline can drop or repair the offending creature instead of
 * crashing the whole evolution run.
 *
 * If the inner call already throws a `TopologyError` it is re-thrown
 * untouched. Any other error (including unrelated bugs) is wrapped with
 * a descriptive message and reason `INVALID_STATE`. The original error
 * is attached via the standard `Error.cause` property so diagnostics can
 * still inspect the underlying trap.
 *
 * Exported for direct unit testing of the trap-translation behaviour;
 * production code reaches it via the per-operation wrappers below.
 */
export function withWasmTrapGuard<T>(opName: string, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof TopologyError) {
      throw err;
    }
    const message = err instanceof Error
      ? `${err.name}: ${err.message}`
      : String(err);
    throw new TopologyError(
      `WASM ${opName} trapped (${message}). The topology is malformed; ` +
        `the caller should drop or repair the creature instead of ` +
        `crashing the evolution run.`,
      "INVALID_STATE",
    );
  }
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
  const result = withWasmTrapGuard(
    "validateTopology",
    () => wasmFn(topology.fromIndices, topology.toIndices),
  );
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
  const flat = withWasmTrapGuard(
    "scanAvailableConnections",
    () =>
      wasmFn(
        topology.fromIndices,
        topology.toIndices,
        topology.isConstant,
        topology.numNeurons,
        topology.numInputs,
      ),
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
  const result = withWasmTrapGuard(
    "computeReverseTopologicalOrder",
    () =>
      wasmFn(
        topology.fromIndices,
        topology.toIndices,
        topology.numNeurons,
        topology.numInputs,
      ),
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
  const result = withWasmTrapGuard(
    "validateStructuralIntegrity",
    () =>
      wasmFn(
        topology.fromIndices,
        topology.toIndices,
        topology.isConstant,
        topology.squashTypes,
        topology.biases,
        topology.numInputs,
        topology.numOutputs,
        topology.synapseTypes,
      ),
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
  const result = withWasmTrapGuard(
    "detectCycles",
    () =>
      wasmFn(
        topology.fromIndices,
        topology.toIndices,
        topology.numNeurons,
        topology.numInputs,
      ),
  );
  return result !== 0;
}
