/**
 * check_wasm_memory_model.ts — CLI gate for `build.sh` (Issue #3743).
 *
 * Reads a `.wasm` module and exits non-zero unless its linear memory declares
 * the expected address size. NEAT-AI-core publishes a wasm32 and a wasm64
 * (Memory64) activation bundle side by side, so a pin that claims wasm64 while
 * the vendored bytes are still i32 would otherwise look perfectly healthy right
 * up to the 4 GiB linear-memory wall.
 *
 * Usage:
 *   deno run --allow-read scripts/check_wasm_memory_model.ts <wasm-file> <wasm32|wasm64>
 */

import {
  assertWasmMemoryModel,
  isWasmMemoryModel,
  WASM_MEMORY_MODELS,
} from "@wasm/WasmMemoryModel.ts";

if (import.meta.main) {
  const [wasmPath, expected] = Deno.args;
  if (!wasmPath || !expected) {
    console.error(
      "Usage: check_wasm_memory_model.ts <wasm-file> <" +
        WASM_MEMORY_MODELS.join("|") + ">",
    );
    Deno.exit(2);
  }
  if (!isWasmMemoryModel(expected)) {
    console.error(
      `ERROR: unknown memory model '${expected}' ` +
        `(expected one of ${WASM_MEMORY_MODELS.join(", ")}).`,
    );
    Deno.exit(2);
  }

  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(wasmPath);
  } catch (error) {
    console.error(
      `ERROR: could not read ${wasmPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exit(2);
  }

  try {
    assertWasmMemoryModel(bytes, expected, wasmPath);
  } catch (error) {
    console.error(
      `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
  console.log(`${wasmPath}: memory model ${expected} — verified.`);
}
