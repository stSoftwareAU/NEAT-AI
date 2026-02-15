/**
 * EnsureWasmActivation Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. ensureWasmActivation succeeds when WASM is already initialised
 * 2. ensureWasmActivation is idempotent (safe to call multiple times)
 * 3. After calling ensureWasmActivation, the WASM module is usable
 */

import { assert } from "@std/assert";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import {
  getSquashFn,
  isWasmActivationAvailable,
} from "../../src/wasm/WasmModuleLoader.ts";

// ---------------------------------------------------------------------------
// Success path tests
// ---------------------------------------------------------------------------

Deno.test("EnsureWasmActivation: succeeds when WASM is already available", async () => {
  // Auto-init should have already loaded WASM. This call should be a no-op.
  await ensureWasmActivation();

  assert(
    isWasmActivationAvailable(),
    "WASM should still be available after ensureWasmActivation",
  );
});

Deno.test("EnsureWasmActivation: is idempotent", async () => {
  // Calling multiple times should not throw or break anything
  await ensureWasmActivation();
  await ensureWasmActivation();
  await ensureWasmActivation();

  assert(
    isWasmActivationAvailable(),
    "WASM should remain available after multiple calls",
  );
});

Deno.test("EnsureWasmActivation: WASM functions are usable afterwards", async () => {
  await ensureWasmActivation();

  const squashFn = getSquashFn();
  assert(squashFn !== null, "squash function should be available");

  // Verify we can actually call the squash function (TANH = 7)
  const result = squashFn!(7, 0.5);
  assert(
    typeof result === "number" && isFinite(result),
    "squash(TANH, 0.5) should return a finite number",
  );
});

// ---------------------------------------------------------------------------
// Concurrent calls
// ---------------------------------------------------------------------------

Deno.test("EnsureWasmActivation: concurrent calls all resolve successfully", async () => {
  // Launch several concurrent calls; all should resolve without error
  const promises = Array.from(
    { length: 10 },
    () => ensureWasmActivation(),
  );

  await Promise.all(promises);

  assert(
    isWasmActivationAvailable(),
    "WASM should be available after concurrent ensures",
  );
});
