/**
 * Regression tests for malformed-buffer hardening — Issue #2659.
 *
 * The TS-side `withWasmTrapGuard` (Issue #2648) is one layer; the
 * underlying Rust hardening (NEAT-AI-core PR for #2659) is the other.
 * Together they guarantee that an evolved creature with a pathological
 * edge list never aborts a long `Creature.evolveRL()` run with an
 * uncatchable `RuntimeError: memory access out of bounds`.
 *
 * These tests feed intentionally corrupt flat arrays directly through
 * the public WASM topology API and assert that **either** the call
 * returns a defined error result (post-hardening) **or** the trap guard
 * converts a trap into a typed `TopologyError` (pre-hardening). Both
 * outcomes are acceptable — what we are guarding against is the third
 * outcome: an uncaught WASM trap escaping into the evolution pipeline.
 */

import { assert, assertEquals } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";
import type { TypedTopology } from "@architecture/TypedTopology.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";
import {
  computeReverseTopologicalOrder,
  detectCycles,
  scanAvailableConnections,
  STRUCTURAL_VALID,
  TOPOLOGY_VALID,
  validateStructuralIntegrity,
  validateTopology,
} from "@wasm/WasmTopologyOps.ts";

// Ensure the WASM bundle is loaded before tests run. The auto-init
// import is normally tripped via `mod.ts`; these direct-import tests
// have to opt in explicitly.
await initWasmActivation();

// ---------------------------------------------------------------------------
// Helpers — duck-typed corrupt TypedTopology objects.
//
// The public TypedTopology constructor is private (Issue #1959), so we
// build minimal shape-compatible objects that exercise only the fields
// each WASM bridge function actually reads. The compile-time cast is
// safe for tests because the WASM functions consume typed array views
// rather than the class identity.
// ---------------------------------------------------------------------------

interface MalformedTopologyOptions {
  fromIndices: Uint32Array;
  toIndices: Uint32Array;
  isConstant?: Uint8Array;
  squashTypes?: Uint8Array;
  synapseTypes?: Uint8Array;
  biases?: Float64Array;
  weights?: Float64Array;
  numNeurons?: number;
  numInputs?: number;
  numOutputs?: number;
}

function malformed(opts: MalformedTopologyOptions): TypedTopology {
  const numNeurons = opts.numNeurons ?? 4;
  const numInputs = opts.numInputs ?? 2;
  const numOutputs = opts.numOutputs ?? 1;
  const synapses = Math.max(opts.fromIndices.length, opts.toIndices.length);
  return {
    fromIndices: opts.fromIndices,
    toIndices: opts.toIndices,
    isConstant: opts.isConstant ?? new Uint8Array(numNeurons),
    squashTypes: opts.squashTypes ?? new Uint8Array(numNeurons),
    synapseTypes: opts.synapseTypes ?? new Uint8Array(synapses),
    biases: opts.biases ?? new Float64Array(numNeurons),
    weights: opts.weights ?? new Float64Array(synapses),
    numNeurons,
    numInputs,
    numOutputs,
    numSynapses: synapses,
  } as unknown as TypedTopology;
}

/**
 * Run a WASM call expected to face a malformed buffer. Returns the
 * result on success, or the caught `TopologyError` on trap. **Re-throws
 * anything else** so an uncaught raw WASM trap fails the test.
 */
function expectDefendedOrTrapGuard<T>(run: () => T): T | TopologyError {
  try {
    return run();
  } catch (err) {
    if (err instanceof TopologyError) {
      return err;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// validateTopology
// ---------------------------------------------------------------------------

Deno.test("validateTopology: length mismatch is defended (no uncaught trap)", () => {
  // from has 3 entries, to has 2 — Rust returns MALFORMED_BUFFER post-#2659;
  // pre-hardening this still went through the trap guard with a defined
  // SORT_ERROR_FROM result. Either way the call must not throw a raw
  // WASM trap.
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1, 2]),
    toIndices: new Uint32Array([2, 2]),
  });

  const result = expectDefendedOrTrapGuard(() => validateTopology(topo));
  // Whether result is a TopologyError or a typed result, the contract is
  // satisfied; assert it is not silently reporting "valid".
  if (result instanceof TopologyError) return;
  assert(
    result.errorCode !== TOPOLOGY_VALID,
    `length mismatch must not be reported as valid (errorCode=${result.errorCode})`,
  );
});

Deno.test("validateTopology: out-of-range indices are defended", () => {
  // Indices past `numNeurons` should not produce a raw trap.
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1, 999_999]),
    toIndices: new Uint32Array([2, 2, 1_000_000]),
  });

  // validate_topology itself does not bounds-check indices against
  // num_neurons (it has no num_neurons argument), but it must still
  // return a defined Vec without trapping.
  const result = expectDefendedOrTrapGuard(() => validateTopology(topo));
  // Result either a TopologyError from the guard, or a typed object —
  // neither should crash the test runner.
  if (!(result instanceof TopologyError)) {
    assertEquals(typeof result.errorCode, "number");
  }
});

// ---------------------------------------------------------------------------
// scanAvailableConnections
// ---------------------------------------------------------------------------

Deno.test("scanAvailableConnections: length mismatch yields defined result", () => {
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1]),
    toIndices: new Uint32Array([2]),
    isConstant: new Uint8Array([0, 0, 0, 0]),
    numNeurons: 4,
    numInputs: 2,
  });

  const result = expectDefendedOrTrapGuard(() =>
    scanAvailableConnections(topo)
  );
  // Either an empty array (post-hardening) or a TopologyError (trap
  // guard). Neither is an uncaught trap.
  if (!(result instanceof TopologyError)) {
    assert(Array.isArray(result), "expected an array of pairs");
  }
});

// ---------------------------------------------------------------------------
// computeReverseTopologicalOrder
// ---------------------------------------------------------------------------

Deno.test("computeReverseTopologicalOrder: OOB to-index does not crash worker", () => {
  // Before #2659 this trapped inside `inward[to].push(...)`.
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1]),
    toIndices: new Uint32Array([2, 99]),
    numNeurons: 4,
    numInputs: 2,
  });

  const result = expectDefendedOrTrapGuard(() =>
    computeReverseTopologicalOrder(topo)
  );
  if (!(result instanceof TopologyError)) {
    assert(Array.isArray(result), "expected a numeric order array");
  }
});

Deno.test("computeReverseTopologicalOrder: length mismatch returns defined result", () => {
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1, 2]),
    toIndices: new Uint32Array([2, 2]),
    numNeurons: 4,
    numInputs: 2,
  });

  const result = expectDefendedOrTrapGuard(() =>
    computeReverseTopologicalOrder(topo)
  );
  if (!(result instanceof TopologyError)) {
    assert(Array.isArray(result));
  }
});

// ---------------------------------------------------------------------------
// validateStructuralIntegrity
// ---------------------------------------------------------------------------

Deno.test("validateStructuralIntegrity: numOutputs > numNeurons is defended", () => {
  // Before #2659 this trapped on the `output_start = num_neurons -
  // output_count` underflow.
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1]),
    toIndices: new Uint32Array([2, 3]),
    biases: new Float64Array([0, 0, 0.5, -0.3]),
    numNeurons: 4,
    numInputs: 2,
    numOutputs: 99,
  });

  const result = expectDefendedOrTrapGuard(() =>
    validateStructuralIntegrity(topo)
  );
  if (result instanceof TopologyError) return;
  assert(
    result.errorCode !== STRUCTURAL_VALID,
    "malformed structural input must not be reported as valid",
  );
});

Deno.test("validateStructuralIntegrity: synapse length mismatch is defended", () => {
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1]),
    toIndices: new Uint32Array([2]),
    biases: new Float64Array([0, 0, 0.5, -0.3]),
    numNeurons: 4,
    numInputs: 2,
    numOutputs: 1,
  });

  const result = expectDefendedOrTrapGuard(() =>
    validateStructuralIntegrity(topo)
  );
  if (result instanceof TopologyError) return;
  assert(
    result.errorCode !== STRUCTURAL_VALID,
    "synapse length mismatch must not be reported as valid",
  );
});

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------

Deno.test("detectCycles: length mismatch does not crash worker", () => {
  const topo = malformed({
    fromIndices: new Uint32Array([0, 1, 2]),
    toIndices: new Uint32Array([2, 2]),
    numNeurons: 4,
    numInputs: 2,
  });

  const result = expectDefendedOrTrapGuard(() => detectCycles(topo));
  if (!(result instanceof TopologyError)) {
    assertEquals(typeof result, "boolean");
  }
});

Deno.test("detectCycles: numInputs > numNeurons is defended", () => {
  const topo = malformed({
    fromIndices: new Uint32Array([0]),
    toIndices: new Uint32Array([1]),
    numNeurons: 2,
    numInputs: 99,
  });

  const result = expectDefendedOrTrapGuard(() => detectCycles(topo));
  if (!(result instanceof TopologyError)) {
    assertEquals(typeof result, "boolean");
  }
});
