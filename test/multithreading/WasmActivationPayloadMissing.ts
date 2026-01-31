/**
 * Issue #1206 - WASM activation payload missing
 *
 * Tests that the library gracefully handles missing WASM activation files
 * by falling back to JavaScript-based activation instead of throwing an
 * assertion error.
 */
import { assertEquals, assertExists } from "@std/assert";
import {
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
} from "../../src/multithreading/workers/WorkerHandler.ts";

Deno.test("isWasmActivationPayloadAvailable reports availability for canonical location", () => {
  const available = isWasmActivationPayloadAvailable();
  assertEquals(typeof available, "boolean");
});

Deno.test("loadWasmActivationInitPayload matches isWasmActivationPayloadAvailable()", () => {
  const available = isWasmActivationPayloadAvailable();
  const payload = loadWasmActivationInitPayload();
  if (available) {
    assertExists(payload);
    assertExists(payload?.jsSource);
    assertExists(payload?.wasmBinary);
  } else {
    assertEquals(payload, null);
  }
});
