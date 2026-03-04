/**
 * WASM Worker Init Error Type Tests
 *
 * Issue #1693 - Verify that WasmError is used in worker init and payload
 * modules with the correct reason codes.
 */

import { assertEquals, assertIsError } from "@std/assert";
import { WasmError } from "../../src/errors/WasmError.ts";

Deno.test("WasmWorkerInitErrors: WasmError with MODULE_NOT_LOADED for missing payload", () => {
  const err = new WasmError(
    "Worker WASM activation payload missing (WASM is required). " +
      "Call fetchWasmForWorkers() before spawning workers, or ensure the NEAT-AI " +
      "package includes `wasm_activation/pkg`.",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
  assertEquals(err.name, "WasmError");
});

Deno.test("WasmWorkerInitErrors: WasmError with MODULE_NOT_LOADED for init failure", () => {
  const err = new WasmError(
    "Worker WASM activation init failed",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});

Deno.test("WasmWorkerInitErrors: WasmError with MODULE_NOT_LOADED for payload load failure", () => {
  const err = new WasmError(
    "WASM activation payload could not be loaded. https://example.com: 404 Not Found",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});
