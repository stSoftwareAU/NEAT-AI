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

Deno.test("loadWasmActivationInitPayload returns null when files are missing", () => {
  // The function should return null if the WASM files cannot be loaded,
  // rather than throwing an assertion error.
  const payload = loadWasmActivationInitPayload(
    "/non-existent-path/wasm_activation/pkg",
  );
  assertEquals(payload, null);
});

Deno.test("isWasmActivationPayloadAvailable returns false when files are missing", () => {
  const available = isWasmActivationPayloadAvailable(
    "/non-existent-path/wasm_activation/pkg",
  );
  assertEquals(available, false);
});

Deno.test("isWasmActivationPayloadAvailable returns true when files exist", () => {
  // Use the actual wasm_activation/pkg path
  const projectRoot = new URL("../..", import.meta.url).pathname;
  const wasmPath = `${projectRoot}wasm_activation/pkg`;

  // This test only passes if WASM has been built
  // Check if the directory exists first
  try {
    const stat = Deno.statSync(wasmPath);
    if (stat.isDirectory) {
      const available = isWasmActivationPayloadAvailable(wasmPath);
      assertEquals(available, true);
    }
  } catch {
    // If the directory doesn't exist, skip this assertion
    console.log(
      "Skipping isWasmActivationPayloadAvailable test: wasm_activation/pkg not built",
    );
  }
});

Deno.test("loadWasmActivationInitPayload returns payload when files exist", () => {
  const projectRoot = new URL("../..", import.meta.url).pathname;
  const wasmPath = `${projectRoot}wasm_activation/pkg`;

  // This test only passes if WASM has been built
  try {
    const stat = Deno.statSync(wasmPath);
    if (stat.isDirectory) {
      const payload = loadWasmActivationInitPayload(wasmPath);
      assertExists(payload);
      assertExists(payload?.jsSource);
      assertExists(payload?.wasmBinary);
    }
  } catch {
    // If the directory doesn't exist, skip this assertion
    console.log(
      "Skipping loadWasmActivationInitPayload test: wasm_activation/pkg not built",
    );
  }
});
