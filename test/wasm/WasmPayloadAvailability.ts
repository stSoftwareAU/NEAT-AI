import { assert } from "@std/assert";
import {
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";

/**
 * Issue #2112: Verify WASM activation payload is available for workers.
 *
 * When the WASM files are missing from the published package, workers
 * cannot bootstrap WASM activation and the library crashes. These tests
 * ensure the payload loading functions work correctly from a local checkout
 * (file: URLs).
 */

Deno.test({
  name: "Issue #2112: WASM activation payload is available (sync check)",
  permissions: { read: true },
  fn: () => {
    const available = isWasmActivationPayloadAvailable();
    assert(
      available,
      "WASM activation payload should be available from a local checkout. " +
        "Ensure wasm_activation/pkg/ contains wasm_activation.js and " +
        "wasm_activation_bg.wasm.",
    );
  },
});

Deno.test({
  name: "Issue #2112: WASM activation payload loads synchronously",
  permissions: { read: true },
  fn: () => {
    const payload = loadWasmActivationInitPayload();
    assert(payload !== null, "Sync payload load should succeed from file: URL");
    assert(
      payload.jsSource.length > 0,
      "JS source should be non-empty",
    );
    assert(
      payload.wasmBinary.length > 0,
      "WASM binary should be non-empty",
    );
  },
});

Deno.test({
  name: "Issue #2112: WASM activation payload loads asynchronously",
  permissions: { read: true, net: true },
  fn: async () => {
    const payload = await loadWasmActivationInitPayloadAsync();
    assert(payload !== null, "Async payload load should succeed");
    assert(
      payload.jsSource.length > 0,
      "JS source should be non-empty",
    );
    assert(
      payload.wasmBinary.length > 0,
      "WASM binary should be non-empty",
    );
  },
});
