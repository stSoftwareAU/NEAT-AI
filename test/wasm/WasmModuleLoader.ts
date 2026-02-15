/**
 * WasmModuleLoader Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. Module loading succeeds and isWasmActivationAvailable returns true
 * 2. Function pointer getters return non-null after initialisation
 * 3. initWasmActivation is idempotent (calling multiple times is safe)
 * 4. initWasmActivationSync handles already-initialised state
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  getCalculateErrorFn,
  getCompiledNetworkClass,
  getDerivativeFn,
  getFusedErrorDistributionFn,
  getGetRangeFn,
  getLimitRangeFn,
  getSquashFn,
  getUnsquashFn,
  getValidateRangeFn,
  getVersionFn,
  initWasmActivation,
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "../../src/wasm/WasmModuleLoader.ts";

// Ensure WASM is initialised before running function pointer tests.
await initWasmActivation();

// ---------------------------------------------------------------------------
// Module availability tests
// ---------------------------------------------------------------------------

Deno.test("WasmModuleLoader: WASM activation is available after init", () => {
  const available = isWasmActivationAvailable();
  assert(
    available,
    "WASM activation should be available after initWasmActivation",
  );
});

Deno.test("WasmModuleLoader: initWasmActivation is idempotent", async () => {
  // Calling init again should succeed without error
  const result1 = await initWasmActivation();
  assert(result1, "First call should return true");

  const result2 = await initWasmActivation();
  assert(result2, "Second call should return true (already initialised)");

  // Module should still be available
  assert(isWasmActivationAvailable(), "Should still be available");
});

// ---------------------------------------------------------------------------
// Function pointer getter tests
// ---------------------------------------------------------------------------

Deno.test("WasmModuleLoader: getSquashFn returns a function after init", () => {
  const fn = getSquashFn();
  assertExists(fn, "squash function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getDerivativeFn returns a function after init", () => {
  const fn = getDerivativeFn();
  assertExists(fn, "derivative function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getUnsquashFn returns a function after init", () => {
  const fn = getUnsquashFn();
  assertExists(fn, "unsquash function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getCalculateErrorFn returns a function after init", () => {
  const fn = getCalculateErrorFn();
  assertExists(fn, "calculateError function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getCompiledNetworkClass returns a constructor after init", () => {
  const cls = getCompiledNetworkClass();
  assertExists(cls, "CompiledNetwork class should be available");
  assertEquals(typeof cls, "function");
});

Deno.test("WasmModuleLoader: getFusedErrorDistributionFn returns a function after init", () => {
  const fn = getFusedErrorDistributionFn();
  assertExists(fn, "fusedErrorDistribution function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getGetRangeFn returns a function after init", () => {
  const fn = getGetRangeFn();
  assertExists(fn, "getRange function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getValidateRangeFn returns a function after init", () => {
  const fn = getValidateRangeFn();
  assertExists(fn, "validateRange function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getLimitRangeFn returns a function after init", () => {
  const fn = getLimitRangeFn();
  assertExists(fn, "limitRange function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: getVersionFn returns a function after init", () => {
  const fn = getVersionFn();
  assertExists(fn, "version function should be available");
  assertEquals(typeof fn, "function");
});

Deno.test("WasmModuleLoader: version function returns a non-empty string", () => {
  const fn = getVersionFn();
  assertExists(fn, "version function should be available");
  const version = fn();
  assert(
    typeof version === "string" && version.length > 0,
    "Version should be a non-empty string",
  );
});

// ---------------------------------------------------------------------------
// Sync init path — already initialised
// ---------------------------------------------------------------------------

Deno.test("WasmModuleLoader: initWasmActivationSync returns true when already initialised", () => {
  // Module is already loaded, so sync init should short-circuit
  const fakeBindings = {};
  const fakeBinary = new Uint8Array([]);

  // Since wasmModule is already set, this should return true without touching
  // the fake bindings at all.
  const result = initWasmActivationSync(fakeBindings, fakeBinary);
  assert(result, "Should return true when module already initialised");
});
