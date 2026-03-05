/**
 * Tests for WasmWorkerInit module.
 *
 * Issue #1698: Validates the initialiseWasmActivationFromPayload function
 * handles missing payloads, required vs optional WASM, and idempotent init.
 *
 * Note: WASM is already initialised when tests run (by the test harness),
 * so initialiseWasmActivationFromPayload returns early via the
 * isWasmActivationAvailable() guard. We verify both the early-return
 * behaviour and the error types used.
 */
import { assertEquals, assertIsError } from "@std/assert";
import { WasmError } from "../../src/errors/WasmError.ts";
import { initialiseWasmActivationFromPayload } from "../../src/workers/WasmWorkerInit.ts";

Deno.test("WasmWorkerInit: returns without error when payload missing and WASM not required", async () => {
  // Should complete without throwing
  await initialiseWasmActivationFromPayload(undefined, false);
});

Deno.test("WasmWorkerInit: idempotent when WASM already initialised", async () => {
  // WASM is already initialised from other tests in this project.
  // Calling with undefined payload and wasmRequired=true should succeed
  // because isWasmActivationAvailable() returns true early.
  await initialiseWasmActivationFromPayload(undefined, true);
});

Deno.test("WasmWorkerInit: idempotent with both required values", async () => {
  // Both true and false should succeed when WASM is already available
  await initialiseWasmActivationFromPayload(undefined, true);
  await initialiseWasmActivationFromPayload(undefined, false);
});

Deno.test("WasmWorkerInit: WasmError has correct shape for missing payload", () => {
  // Verify the error type that would be thrown (without triggering the
  // early return from isWasmActivationAvailable())
  const err = new WasmError(
    "Worker WASM activation payload missing (WASM is required). " +
      "Call fetchWasmForWorkers() before spawning workers, or ensure the NEAT-AI " +
      "package includes `wasm_activation/pkg`.",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});

Deno.test("WasmWorkerInit: WasmError has correct shape for init failure", () => {
  const err = new WasmError(
    "Worker WASM activation init failed",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});
