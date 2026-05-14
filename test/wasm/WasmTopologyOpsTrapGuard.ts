/**
 * Tests for the WASM topology trap guard (Issue #2648).
 *
 * The native WASM topology validators (`validate_topology`,
 * `validate_structural_integrity`, ...) occasionally trap with
 * `RuntimeError: memory access out of bounds` on a malformed evolved
 * creature. The previous flow let that trap escape uncaught all the way
 * out of `Offspring.breed`, terminating long `Creature.evolveRL()` runs.
 *
 * `withWasmTrapGuard` in `WasmTopologyOps.ts` catches the trap at the
 * WASM boundary and re-throws it as a typed `TopologyError` so the
 * breeding / upgrade pipeline can drop or repair the offending creature
 * instead of crashing the run.
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";
import { withWasmTrapGuard } from "@wasm/WasmTopologyOps.ts";

// ---------------------------------------------------------------------------
// Happy path — successful returns are forwarded unchanged.
// ---------------------------------------------------------------------------

Deno.test("withWasmTrapGuard: returns inner result on success", () => {
  const arr = new Int32Array([0, 0]);
  const result = withWasmTrapGuard("validateTopology", () => arr);
  assertStrictEquals(result, arr);
});

// ---------------------------------------------------------------------------
// Trap path — a generic Error from the WASM call becomes a TopologyError.
// ---------------------------------------------------------------------------

Deno.test("withWasmTrapGuard: wraps RuntimeError as TopologyError", () => {
  // Simulate the trap the issue reports: `RuntimeError: memory access out
  // of bounds`. We use a stock Error because `RuntimeError` is not a
  // separate exported type in V8 — only the name matters for the guard.
  const trap = new Error("memory access out of bounds");
  trap.name = "RuntimeError";

  let caught: unknown;
  try {
    withWasmTrapGuard("validateTopology", () => {
      throw trap;
    });
  } catch (e) {
    caught = e;
  }

  assert(caught instanceof TopologyError, "expected TopologyError");
  const err = caught as TopologyError;
  assertEquals(err.reason, "INVALID_STATE");
  assert(
    err.message.includes("WASM validateTopology trapped"),
    `message should name the op: ${err.message}`,
  );
  assert(
    err.message.includes("memory access out of bounds"),
    `message should preserve the trap text: ${err.message}`,
  );
  assert(
    err.message.includes("drop or repair"),
    `message should hint at recovery: ${err.message}`,
  );
});

Deno.test("withWasmTrapGuard: includes op name in wrapped error", () => {
  const trap = new Error("unreachable");
  trap.name = "RuntimeError";

  let caught: unknown;
  try {
    withWasmTrapGuard("detectCycles", () => {
      throw trap;
    });
  } catch (e) {
    caught = e;
  }

  assert(caught instanceof TopologyError);
  assert(
    (caught as Error).message.includes("WASM detectCycles trapped"),
    "expected op name in error message",
  );
});

// ---------------------------------------------------------------------------
// Pre-existing typed errors propagate unchanged so callers retain
// fine-grained `reason` values from upstream checks.
// ---------------------------------------------------------------------------

Deno.test("withWasmTrapGuard: re-throws TopologyError untouched", () => {
  const original = new TopologyError(
    "duplicate connection",
    "INVALID_CONNECTION",
  );

  let caught: unknown;
  try {
    withWasmTrapGuard("validateTopology", () => {
      throw original;
    });
  } catch (e) {
    caught = e;
  }

  assertStrictEquals(caught, original);
});

// ---------------------------------------------------------------------------
// Non-Error throwables (rare, but possible — e.g. WASM glue throwing a
// raw value) still produce a typed TopologyError with a useful message.
// ---------------------------------------------------------------------------

Deno.test("withWasmTrapGuard: wraps non-Error throwables", () => {
  let caught: unknown;
  try {
    withWasmTrapGuard("validateTopology", () => {
      // deno-lint-ignore no-throw-literal
      throw "raw string trap";
    });
  } catch (e) {
    caught = e;
  }

  assert(caught instanceof TopologyError);
  assert(
    (caught as Error).message.includes("raw string trap"),
    "expected raw string to appear in wrapped message",
  );
});
