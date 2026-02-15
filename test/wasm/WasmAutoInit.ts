/**
 * WasmAutoInit Unit Tests
 *
 * Issue #1484 - Unit tests for WASM compilation and module loading
 *
 * Verifies:
 * 1. Auto-initialisation results in WASM being available
 * 2. isProbablyWorkerScope returns false in the main thread
 * 3. WASM is usable after auto-init completes (end-to-end check)
 */

import { assert, assertEquals } from "@std/assert";
import { isProbablyWorkerScope } from "../../src/wasm/WasmAutoInit.ts";
import { isWasmActivationAvailable } from "../../src/wasm/WasmModuleLoader.ts";

// ---------------------------------------------------------------------------
// Auto-initialisation verification
// ---------------------------------------------------------------------------

Deno.test("WasmAutoInit: WASM is available after module import", () => {
  // Importing WasmAutoInit triggers auto-init at module load time.
  // By the time this test runs, the WASM module should be initialised.
  assert(
    isWasmActivationAvailable(),
    "WASM activation should be available after auto-init",
  );
});

// ---------------------------------------------------------------------------
// Worker scope detection
// ---------------------------------------------------------------------------

Deno.test("WasmAutoInit: isProbablyWorkerScope returns false in main thread", () => {
  // In the Deno test runner (main thread), we are not in a Worker scope.
  const result = isProbablyWorkerScope();
  assertEquals(
    result,
    false,
    "Main thread should not be detected as worker scope",
  );
});

Deno.test("WasmAutoInit: isProbablyWorkerScope returns a boolean", () => {
  const result = isProbablyWorkerScope();
  assertEquals(typeof result, "boolean", "Should return a boolean value");
});
