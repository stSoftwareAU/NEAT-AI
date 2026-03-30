/**
 * Tests for WasmActivationPayload module.
 *
 * Issue #1698: Validates the WASM activation payload loading,
 * caching, availability checking, and prefetch utilities.
 */
import { assertEquals, assertExists } from "@std/assert";
import {
  fetchWasmForWorkers,
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";

Deno.test("WasmActivationPayload: isWasmActivationPayloadAvailable returns boolean", () => {
  const result = isWasmActivationPayloadAvailable();
  assertEquals(typeof result, "boolean");
});

Deno.test("WasmActivationPayload: loadWasmActivationInitPayload returns payload or null", () => {
  const payload = loadWasmActivationInitPayload();
  if (isWasmActivationPayloadAvailable()) {
    assertExists(payload, "payload should exist when WASM is available");
    assertExists(payload!.jsSource, "jsSource should be present");
    assertExists(payload!.wasmBinary, "wasmBinary should be present");
    assertEquals(typeof payload!.jsSource, "string");
    assertEquals(
      payload!.wasmBinary instanceof Uint8Array,
      true,
      "wasmBinary should be a Uint8Array",
    );
  } else {
    assertEquals(
      payload,
      null,
      "payload should be null when WASM is unavailable",
    );
  }
});

Deno.test("WasmActivationPayload: sync loader is idempotent (returns cached payload)", () => {
  const first = loadWasmActivationInitPayload();
  const second = loadWasmActivationInitPayload();
  // Both calls should return the exact same reference if WASM is available
  if (first !== null) {
    assertEquals(
      first === second,
      true,
      "cached payload should return same reference",
    );
  } else {
    assertEquals(second, null);
  }
});

Deno.test("WasmActivationPayload: async loader returns payload", async () => {
  const payload = await loadWasmActivationInitPayloadAsync();
  assertExists(payload, "async loader should return a payload");
  assertExists(payload.jsSource, "jsSource should be present");
  assertExists(payload.wasmBinary, "wasmBinary should be present");
});

Deno.test("WasmActivationPayload: async loader de-duplicates concurrent calls", async () => {
  // Fire two concurrent async loads - they should de-duplicate
  const [p1, p2] = await Promise.all([
    loadWasmActivationInitPayloadAsync(),
    loadWasmActivationInitPayloadAsync(),
  ]);
  // Both should succeed and return the same cached payload
  assertExists(p1);
  assertExists(p2);
  assertEquals(
    p1 === p2,
    true,
    "concurrent async loads should return same cached reference",
  );
});

Deno.test("WasmActivationPayload: fetchWasmForWorkers completes without error", async () => {
  // fetchWasmForWorkers is a thin wrapper over loadWasmActivationInitPayloadAsync
  await fetchWasmForWorkers();
  // If we get here without throwing, it succeeded
  const payload = loadWasmActivationInitPayload();
  assertExists(payload, "payload should be cached after fetchWasmForWorkers");
});

Deno.test("WasmActivationPayload: availability matches sync load result", () => {
  const available = isWasmActivationPayloadAvailable();
  const payload = loadWasmActivationInitPayload();
  if (available) {
    assertExists(payload, "payload should exist when availability is true");
  }
  // Note: payload may be non-null from cache even if availability check
  // would fail for fresh files, so we only assert in the available=true case
});
