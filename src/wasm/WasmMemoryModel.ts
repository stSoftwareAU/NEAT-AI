/**
 * WasmMemoryModel.ts — read the address size of a WebAssembly module's linear
 * memory and refuse to run on the wrong one (Issue #3743).
 *
 * NEAT-AI vendors `wasm_activation/pkg` from NEAT-AI-core. A **wasm32** bundle
 * caps linear memory at 4 GiB (65 536 pages of 64 KiB); a **wasm64**
 * (Memory64) bundle declares an `i64` index type and has no such wall. The two
 * bundles are published side by side by NEAT-AI-core CI, so a pin that claims
 * wasm64 while the vendored bytes are still i32 would look completely healthy
 * — every test would pass, right up to the 4 GiB ceiling nobody expected to
 * still be there.
 *
 * This module is the single source of truth for that distinction. It is used
 * by:
 *
 * - `build.sh` (via `scripts/check_wasm_memory_model.ts`) to gate the
 *   downloaded and the vendored bundle against `deno.json`
 *   `neatCore.memoryModel`, and
 * - {@link file://./WasmModuleLoader.ts} to gate the bytes actually
 *   instantiated at runtime against {@link
 *   file://./WasmBundleSha256.ts EXPECTED_WASM_MEMORY_MODEL}.
 *
 * There is deliberately **no fallback**: a mismatch throws, exactly like a
 * missing bundle does, rather than quietly running the wasm32 copy.
 *
 * ## The two ceilings
 *
 * The V8 JS heap and WASM linear memory are separate address spaces with
 * separate levers. `--max-old-space-size` raises the JS heap; the wasm64
 * bundle raises the linear-memory ceiling. Neither lifts the other — see
 * `docs/MEMORY.md`.
 */

import { WasmError } from "@errors/WasmError.ts";

/** Address size of a module's linear memory. */
export type WasmMemoryModel = "wasm32" | "wasm64";

/** Every model this repo understands, in declaration order. */
export const WASM_MEMORY_MODELS: readonly WasmMemoryModel[] = [
  "wasm32",
  "wasm64",
];

/** Bytes per WebAssembly page. */
export const WASM_PAGE_BYTES = 65_536;

/** Page ceiling of a wasm32 linear memory (4 GiB / 64 KiB). */
export const WASM32_MAX_PAGES = 65_536;

/** `\0asm` — the WebAssembly magic number. */
const WASM_MAGIC = Object.freeze([0x00, 0x61, 0x73, 0x6d]);

/** Section id of the memory section in the binary format. */
const MEMORY_SECTION_ID = 5;

/**
 * Bit 2 of a `limits` flags byte marks the memory as 64-bit indexed
 * (the Memory64 proposal). Bit 0 is "has max", bit 1 is "shared".
 */
const MEMORY64_FLAG = 0x04;

/** Narrow an unknown value to a valid model name. */
export function isWasmMemoryModel(value: unknown): value is WasmMemoryModel {
  return typeof value === "string" &&
    (WASM_MEMORY_MODELS as readonly string[]).includes(value);
}

/** Little-endian LEB128 unsigned decode, bounded so junk cannot loop forever. */
function readUnsignedLeb128(
  bytes: Uint8Array,
  start: number,
): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let offset = start;
  for (;;) {
    if (offset >= bytes.length) {
      throw new WasmError(
        `WASM bundle is truncated: LEB128 value at offset ${start} runs past the end of the ${bytes.length}-byte module.`,
        "COMPILATION_FAILED",
      );
    }
    const byte = bytes[offset++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return { value: result, next: offset };
    }
    shift += 7;
    if (shift > 63) {
      throw new WasmError(
        `WASM bundle is malformed: LEB128 value at offset ${start} exceeds 64 bits.`,
        "COMPILATION_FAILED",
      );
    }
  }
}

/**
 * Read the address size declared by the module's own memory section.
 *
 * Only a module-defined memory is inspected. A module that *imports* its
 * memory has no memory section, and this throws rather than guessing — the
 * NEAT-AI-core bundle always defines its own.
 *
 * @param bytes The complete `.wasm` module.
 * @throws {WasmError} when the bytes are not a WebAssembly module, are
 *   truncated, or declare no memory at all.
 */
export function detectWasmMemoryModel(bytes: Uint8Array): WasmMemoryModel {
  if (bytes.length < 8) {
    throw new WasmError(
      `WASM bundle is too short to be a module: ${bytes.length} bytes (need at least 8).`,
      "COMPILATION_FAILED",
    );
  }
  for (let i = 0; i < WASM_MAGIC.length; i++) {
    if (bytes[i] !== WASM_MAGIC[i]) {
      throw new WasmError(
        `WASM bundle does not start with the \\0asm magic number ` +
          `(got 0x${bytes[0].toString(16).padStart(2, "0")}...).`,
        "COMPILATION_FAILED",
      );
    }
  }

  let offset = 8;
  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const { value: sectionSize, next } = readUnsignedLeb128(bytes, offset);
    const sectionStart = next;
    const sectionEnd = sectionStart + sectionSize;
    if (sectionEnd > bytes.length) {
      throw new WasmError(
        `WASM bundle is truncated: section ${sectionId} claims ${sectionSize} bytes but only ` +
          `${bytes.length - sectionStart} remain.`,
        "COMPILATION_FAILED",
      );
    }
    if (sectionId === MEMORY_SECTION_ID) {
      const { value: count, next: afterCount } = readUnsignedLeb128(
        bytes,
        sectionStart,
      );
      if (count < 1) {
        throw new WasmError(
          "WASM bundle declares an empty memory section; the activation bundle must define one linear memory.",
          "COMPILATION_FAILED",
        );
      }
      const flags = bytes[afterCount];
      return (flags & MEMORY64_FLAG) !== 0 ? "wasm64" : "wasm32";
    }
    offset = sectionEnd;
  }

  throw new WasmError(
    "WASM bundle declares no memory section; its address size cannot be verified.",
    "COMPILATION_FAILED",
  );
}

/**
 * Fail loud when the bundle's address size is not the one that was pinned.
 *
 * @param bytes The complete `.wasm` module.
 * @param expected The model the pin claims (`deno.json` `neatCore.memoryModel`
 *   at build time, `EXPECTED_WASM_MEMORY_MODEL` at runtime).
 * @param source Human-readable origin of the bytes, quoted in the error so the
 *   operator knows which copy is wrong.
 * @returns The detected model, which always equals `expected` on return.
 * @throws {WasmError} on any mismatch — there is no wasm32 fallback.
 */
export function assertWasmMemoryModel(
  bytes: Uint8Array,
  expected: WasmMemoryModel,
  source: string,
): WasmMemoryModel {
  const actual = detectWasmMemoryModel(bytes);
  if (actual !== expected) {
    throw new WasmError(
      `WASM bundle memory model mismatch for ${source}: pinned as ${expected} but the module declares ` +
        `${actual} linear memory. ${
          expected === "wasm64"
            ? "A wasm32 bundle caps linear memory at 4 GiB; refusing to fall back to it silently. " +
              "Re-run ./build.sh to fetch the Memory64 asset for the pinned NEAT-AI-core revision."
            : "Re-run ./build.sh to fetch the asset matching deno.json neatCore.memoryModel."
        }`,
      "MODULE_NOT_LOADED",
    );
  }
  return actual;
}

/**
 * Grow a linear memory by `deltaPages`, failing loud rather than truncating.
 *
 * `WebAssembly.Memory.prototype.grow` on a Memory64 memory takes a **BigInt**
 * page delta; a `Number` throws. The delta is therefore a `bigint` here for
 * both models, and a non-`bigint` is rejected explicitly instead of being
 * coerced — a silently truncated delta would grow the memory by the wrong
 * amount and only surface as an out-of-bounds trap much later.
 *
 * @param memory The memory to grow.
 * @param deltaPages Pages to add. Must be a non-negative `bigint`.
 * @param model The memory's address size, from {@link detectWasmMemoryModel}.
 * @returns The previous size in pages.
 * @throws {WasmError} when the delta is not a non-negative `bigint`, or when a
 *   wasm32 memory is asked to grow past its 4 GiB page ceiling.
 */
export function growWasmMemory(
  memory: WebAssembly.Memory,
  deltaPages: bigint,
  model: WasmMemoryModel,
): number {
  if (typeof deltaPages !== "bigint") {
    throw new WasmError(
      `WASM memory grow delta must be a bigint (got ${typeof deltaPages}); ` +
        "a Number delta would silently truncate past 2^53 pages and is rejected.",
      "MODULE_NOT_LOADED",
    );
  }
  if (deltaPages < 0n) {
    throw new WasmError(
      `WASM memory grow delta must be non-negative (got ${deltaPages}).`,
      "MODULE_NOT_LOADED",
    );
  }
  if (model === "wasm64") {
    // Memory64 takes the BigInt directly and returns the previous size as a
    // BigInt; page counts stay far inside Number's safe range. TypeScript's
    // bundled `lib.dom` still types `grow` as `(number) => number`, so the
    // Memory64 signature is asserted locally rather than globally.
    const memory64 = memory as unknown as { grow(delta: bigint): bigint };
    return Number(memory64.grow(deltaPages));
  }
  if (deltaPages > BigInt(WASM32_MAX_PAGES)) {
    throw new WasmError(
      `Cannot grow a wasm32 linear memory by ${deltaPages} pages: the whole address space is ` +
        `${WASM32_MAX_PAGES} pages (4 GiB). Pin the wasm64 bundle to lift this ceiling.`,
      "MODULE_NOT_LOADED",
    );
  }
  return memory.grow(Number(deltaPages));
}
