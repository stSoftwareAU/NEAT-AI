/**
 * Issue #3230 — `requireWasm` must fail loud with the *real* reason the
 * NEAT-AI-core WASM bundle could not be loaded.
 *
 * A NEAT-AI training run aborted inside `simplify()` because
 * `WasmTopologyOps.validateTopology` could not load the bundle. The old error
 * only said "Run ./build.sh", which is useless to a project consuming
 * `@stsoftware/neat-ai` from JSR (it cannot rebuild the vendored bundle) and
 * hid the actual cause (e.g. a Deno `PermissionDenied` net/read error).
 *
 * These tests exercise the exported `requireWasm` guard directly with an
 * injected load error, so they do not depend on the ambient WASM state.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { requireWasm } from "@wasm/WasmTopologyOps.ts";

Deno.test("requireWasm returns the function when the bundle is loaded", () => {
  const fn = (a: number) => a + 1;
  const resolved = requireWasm(fn, "validateTopology", null);
  assertEquals(resolved, fn);
  assertEquals(resolved(41), 42);
});

Deno.test("requireWasm surfaces the underlying load error as the cause", () => {
  const loadError = new Error(
    'PermissionDenied: Requires net access to "jsr.io"',
  );
  loadError.name = "PermissionDenied";

  let thrown: unknown;
  try {
    requireWasm(null, "validateTopology", loadError);
  } catch (err) {
    thrown = err;
  }

  assert(thrown instanceof Error, "requireWasm should throw an Error");
  const message = (thrown as Error).message;
  // Names the failing operation and the WASM bundle requirement.
  assertStringIncludes(message, "WasmTopologyOps.validateTopology");
  assertStringIncludes(message, "NEAT-AI-core WASM bundle");
  // Surfaces the real cause instead of a generic message.
  assertStringIncludes(message, "PermissionDenied");
  assertStringIncludes(message, "net access");
  // Guidance for JSR consumers (who cannot run ./build.sh).
  assertStringIncludes(message, "JSR");
  // The original error is attached via Error.cause for diagnostics.
  assertEquals((thrown as Error).cause, loadError);
});

Deno.test("requireWasm explains a never-initialised bundle when no cause recorded", () => {
  let thrown: unknown;
  try {
    requireWasm(undefined, "scanAvailableConnections", null);
  } catch (err) {
    thrown = err;
  }

  assert(thrown instanceof Error, "requireWasm should throw an Error");
  const message = (thrown as Error).message;
  assertStringIncludes(message, "WasmTopologyOps.scanAvailableConnections");
  assertStringIncludes(message, "never initialised");
  // No cause is attached when there is no recorded load error.
  assertEquals((thrown as Error).cause, undefined);
});
