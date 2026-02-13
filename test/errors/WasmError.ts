import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import { WasmError, type WasmErrorReason } from "../../src/errors/WasmError.ts";

Deno.test("WasmError - COMPILATION_FAILED reason", () => {
  const error = new WasmError(
    "WASM module failed to compile",
    "COMPILATION_FAILED",
  );
  assertIsError(error, WasmError);
  assertEquals(error.message, "WASM module failed to compile");
  assertEquals(error.reason, "COMPILATION_FAILED");
  assertEquals(error.name, "WasmError");
});

Deno.test("WasmError - ACTIVATION_FAILED reason", () => {
  const error = new WasmError(
    "Activation function returned NaN",
    "ACTIVATION_FAILED",
  );
  assertIsError(error, WasmError);
  assertEquals(error.reason, "ACTIVATION_FAILED");
});

Deno.test("WasmError - MODULE_NOT_LOADED reason", () => {
  const error = new WasmError(
    "WASM not initialised",
    "MODULE_NOT_LOADED",
  );
  assertIsError(error, WasmError);
  assertEquals(error.reason, "MODULE_NOT_LOADED");
});

Deno.test("WasmError - is instanceof Error", () => {
  const error = new WasmError("test", "MODULE_NOT_LOADED");
  assert(error instanceof Error);
  assert(error instanceof WasmError);
});

Deno.test("WasmError - can be caught selectively", () => {
  const fn = () => {
    throw new WasmError("module not loaded", "MODULE_NOT_LOADED");
  };

  assertThrows(fn, WasmError);
});

Deno.test("WasmError - reason is typed", () => {
  // Verify all expected reason values are valid
  const reasons: WasmErrorReason[] = [
    "COMPILATION_FAILED",
    "ACTIVATION_FAILED",
    "MODULE_NOT_LOADED",
  ];

  for (const reason of reasons) {
    const error = new WasmError(`test: ${reason}`, reason);
    assertEquals(error.reason, reason);
  }
});

Deno.test("WasmError - distinguishable from generic Error", () => {
  try {
    throw new WasmError("not loaded", "MODULE_NOT_LOADED");
  } catch (e) {
    if (e instanceof WasmError) {
      assertEquals(e.reason, "MODULE_NOT_LOADED");
    } else {
      throw new Error("Expected WasmError instance");
    }
  }
});
