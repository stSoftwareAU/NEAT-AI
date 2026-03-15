/**
 * WasmModuleLoader Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. Module loading succeeds and isWasmActivationAvailable returns true
 * 2. All function getters return non-null after initialisation
 * 3. initWasmActivation is idempotent (safe to call multiple times)
 * 4. Version function returns a non-empty string
 */

import { assert, assertExists } from "@std/assert";
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
// Function getter tests — all WASM function pointers are populated after init
// ---------------------------------------------------------------------------

Deno.test("WasmModuleLoader: all function getters return non-null after init", () => {
  const getters = [
    { name: "getSquashFn", fn: getSquashFn },
    { name: "getDerivativeFn", fn: getDerivativeFn },
    { name: "getUnsquashFn", fn: getUnsquashFn },
    { name: "getCalculateErrorFn", fn: getCalculateErrorFn },
    { name: "getCompiledNetworkClass", fn: getCompiledNetworkClass },
    { name: "getFusedErrorDistributionFn", fn: getFusedErrorDistributionFn },
    { name: "getGetRangeFn", fn: getGetRangeFn },
    { name: "getValidateRangeFn", fn: getValidateRangeFn },
    { name: "getLimitRangeFn", fn: getLimitRangeFn },
    { name: "getVersionFn", fn: getVersionFn },
  ];

  for (const { name, fn } of getters) {
    const result = fn();
    assertExists(result, `${name} should return a non-null value after init`);
  }
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
