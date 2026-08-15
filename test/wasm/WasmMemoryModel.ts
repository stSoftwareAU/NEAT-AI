/**
 * Issue #3743 — the vendored activation bundle must be the Memory64 (wasm64)
 * artefact, and a wasm32 copy must fail loud rather than being run silently.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertWasmMemoryModel,
  detectWasmMemoryModel,
  growWasmMemory,
  isWasmMemoryModel,
  WASM32_MAX_PAGES,
} from "@wasm/WasmMemoryModel.ts";
import { EXPECTED_WASM_MEMORY_MODEL } from "@wasm/WasmBundleSha256.ts";
import { WasmError } from "@errors/WasmError.ts";

/**
 * Hand-assemble the smallest module that declares one linear memory and
 * exports it, so the parser and the runtime can both be driven without the
 * 500 KB production bundle.
 *
 * @param flags `limits` flags byte — bit 2 (0x04) marks Memory64.
 */
function memoryOnlyModule(flags: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d, // \0asm
    0x01,
    0x00,
    0x00,
    0x00, // version 1
    0x05,
    0x03,
    0x01,
    flags,
    0x01, // memory section: 1 memory, flags, min 1 page
    0x07,
    0x0a,
    0x01, // export section: 1 export
    0x06,
    0x6d,
    0x65,
    0x6d,
    0x6f,
    0x72,
    0x79, // "memory"
    0x02,
    0x00, // kind memory, index 0
  ]);
}

function instantiateMemory(flags: number): WebAssembly.Memory {
  const bytes = memoryOnlyModule(flags);
  assert(WebAssembly.validate(bytes), "hand-built module must validate");
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
  return instance.exports.memory as WebAssembly.Memory;
}

const VENDORED_WASM = new URL(
  "../../wasm_activation/pkg/wasm_activation_bg.wasm",
  import.meta.url,
);

Deno.test("detectWasmMemoryModel: reads wasm32 from an i32 memory section", () => {
  assertEquals(detectWasmMemoryModel(memoryOnlyModule(0x00)), "wasm32");
});

Deno.test("detectWasmMemoryModel: reads wasm64 from an i64 memory section", () => {
  assertEquals(detectWasmMemoryModel(memoryOnlyModule(0x04)), "wasm64");
});

Deno.test("detectWasmMemoryModel: a shared bounded i64 memory is still wasm64", () => {
  // flags 0x07 = has-max | shared | i64.
  const bytes = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x05,
    0x04,
    0x01,
    0x07,
    0x01,
    0x02,
  ]);
  assertEquals(detectWasmMemoryModel(bytes), "wasm64");
});

Deno.test("detectWasmMemoryModel: rejects bytes that are not a WASM module", () => {
  const error = assertThrows(
    () => detectWasmMemoryModel(new Uint8Array(16)),
    WasmError,
  );
  assert(
    error.message.includes("magic"),
    `expected a magic-number complaint, got: ${error.message}`,
  );
});

Deno.test("detectWasmMemoryModel: rejects a module with no memory section", () => {
  const bytes = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
  ]);
  const error = assertThrows(() => detectWasmMemoryModel(bytes), WasmError);
  assert(
    error.message.includes("no memory section"),
    `expected a missing-memory complaint, got: ${error.message}`,
  );
});

Deno.test("detectWasmMemoryModel: rejects a truncated section header", () => {
  // Section 5 claims 200 bytes but the module ends immediately.
  const bytes = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x05,
    0xc8,
    0x01,
    0x01,
  ]);
  assertThrows(() => detectWasmMemoryModel(bytes), WasmError);
});

Deno.test({
  name: "the vendored activation bundle is a Memory64 (wasm64) module",
  permissions: { read: true },
  fn: async () => {
    const bytes = await Deno.readFile(VENDORED_WASM);
    assertEquals(detectWasmMemoryModel(bytes), "wasm64");
  },
});

Deno.test({
  name: "the vendored bundle matches the generated EXPECTED_WASM_MEMORY_MODEL",
  permissions: { read: true },
  fn: async () => {
    const bytes = await Deno.readFile(VENDORED_WASM);
    assertEquals(
      assertWasmMemoryModel(bytes, EXPECTED_WASM_MEMORY_MODEL, "vendored pkg"),
      EXPECTED_WASM_MEMORY_MODEL,
    );
  },
});

Deno.test("assertWasmMemoryModel: a wasm32 bundle under a wasm64 pin fails loud", () => {
  const error = assertThrows(
    () =>
      assertWasmMemoryModel(
        memoryOnlyModule(0x00),
        "wasm64",
        "wasm_activation/pkg/wasm_activation_bg.wasm",
      ),
    WasmError,
  );
  assertEquals(error.reason, "MODULE_NOT_LOADED");
  assert(
    error.message.includes("wasm64") && error.message.includes("wasm32"),
    `error must name both models, got: ${error.message}`,
  );
  assert(
    error.message.includes("wasm_activation/pkg/wasm_activation_bg.wasm"),
    `error must name the offending bundle, got: ${error.message}`,
  );
});

Deno.test("assertWasmMemoryModel: a wasm64 bundle under a wasm32 pin also fails loud", () => {
  assertThrows(
    () =>
      assertWasmMemoryModel(memoryOnlyModule(0x04), "wasm32", "test bundle"),
    WasmError,
  );
});

Deno.test("isWasmMemoryModel: narrows only the two known names", () => {
  assert(isWasmMemoryModel("wasm32"));
  assert(isWasmMemoryModel("wasm64"));
  assert(!isWasmMemoryModel("wasm128"));
  assert(!isWasmMemoryModel(64));
  assert(!isWasmMemoryModel(undefined));
});

Deno.test("growWasmMemory: grows a Memory64 memory with a bigint delta", () => {
  const memory = instantiateMemory(0x04);
  assertEquals(growWasmMemory(memory, 2n, "wasm64"), 1);
  assertEquals(memory.buffer.byteLength, 3 * 65_536);
});

Deno.test("growWasmMemory: grows a wasm32 memory with a bigint delta", () => {
  const memory = instantiateMemory(0x00);
  assertEquals(growWasmMemory(memory, 2n, "wasm32"), 1);
  assertEquals(memory.buffer.byteLength, 3 * 65_536);
});

Deno.test("growWasmMemory: a Number delta fails loud instead of truncating", () => {
  const memory = instantiateMemory(0x04);
  const error = assertThrows(
    // deno-lint-ignore no-explicit-any
    () => growWasmMemory(memory, 2 as any, "wasm64"),
    WasmError,
  );
  assert(
    error.message.includes("bigint"),
    `error must name the required type, got: ${error.message}`,
  );
  assertEquals(
    memory.buffer.byteLength,
    65_536,
    "a rejected grow must not have resized the memory",
  );
});

Deno.test("growWasmMemory: a negative delta fails loud", () => {
  const memory = instantiateMemory(0x04);
  assertThrows(() => growWasmMemory(memory, -1n, "wasm64"), WasmError);
});

Deno.test("growWasmMemory: wasm32 rejects a delta past the 4 GiB page ceiling", () => {
  const memory = instantiateMemory(0x00);
  const error = assertThrows(
    () => growWasmMemory(memory, BigInt(WASM32_MAX_PAGES) + 1n, "wasm32"),
    WasmError,
  );
  assert(
    error.message.includes("4 GiB"),
    `error must name the wasm32 ceiling, got: ${error.message}`,
  );
});

Deno.test("growWasmMemory: wasm64 grows past the wasm32 4 GiB page ceiling arithmetic", () => {
  // Proves the delta is not being truncated through a 32-bit path: the page
  // count requested is larger than the entire wasm32 address space. The grow
  // itself is expected to fail on memory pressure, not on a type/range error,
  // so only a RangeError is tolerated here.
  const memory = instantiateMemory(0x04);
  try {
    growWasmMemory(memory, BigInt(WASM32_MAX_PAGES) + 1n, "wasm64");
  } catch (error) {
    assert(
      error instanceof RangeError,
      `a wasm64 memory must reject an over-large grow as a RangeError, got: ${error}`,
    );
  }
});
