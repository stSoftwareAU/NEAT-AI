/**
 * C library heap helpers (Issue #4126).
 *
 * Buffers handed to a `nonblocking` FFI call must outlive the worker isolate:
 * a terminated worker's ArrayBuffers are freed, and Deno does not keep a
 * nonblocking call's `buffer` arguments alive, so a late native write into them
 * would be a write-after-free. Memory from the C heap is never freed by Deno.
 *
 * Failures throw; there is no fallback.
 */

// cspell:disable-next-line
const LIBC_NAME = Deno.build.os === "darwin"
  ? "libSystem.B.dylib"
  : Deno.build.os === "windows"
  ? "msvcrt.dll"
  : "libc.so.6";

const HEAP_SYMBOLS = {
  calloc: {
    parameters: ["usize", "usize"],
    result: "pointer",
    nonblocking: false,
  },
  free: { parameters: ["pointer"], result: "void", nonblocking: false },
  memcpy: {
    parameters: ["pointer", "buffer", "usize"],
    result: "pointer",
    nonblocking: false,
  },
} as const;

let heap: Deno.DynamicLibrary<typeof HEAP_SYMBOLS> | null = null;

function loadHeap(): Deno.DynamicLibrary<typeof HEAP_SYMBOLS> {
  if (heap !== null) return heap;
  try {
    heap = Deno.dlopen(LIBC_NAME, HEAP_SYMBOLS);
  } catch (error) {
    throw new Error(
      `Failed to open the C library ${LIBC_NAME} for native buffers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return heap;
}

/** Allocate zeroed C-heap memory. Release with {@link freeNative}. */
export function allocNativeZeroed(byteLength: number): Deno.PointerObject {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error(
      `allocNativeZeroed: byteLength must be a positive integer; got ${
        String(byteLength)
      }`,
    );
  }
  const ptr = loadHeap().symbols.calloc(1n, BigInt(byteLength));
  if (ptr === null) {
    throw new Error(
      `calloc in ${LIBC_NAME} returned null for ${byteLength} bytes`,
    );
  }
  return ptr;
}

/** Copy `bytes` into new C-heap memory. Release with {@link freeNative}. */
export function allocNativeCopy(bytes: Uint8Array): Deno.PointerObject {
  const ptr = allocNativeZeroed(Math.max(1, bytes.byteLength));
  try {
    if (bytes.byteLength > 0) {
      loadHeap().symbols.memcpy(ptr, bytes, BigInt(bytes.byteLength));
    }
  } catch (error) {
    loadHeap().symbols.free(ptr);
    throw error;
  }
  return ptr;
}

/** Release memory from {@link allocNativeCopy} / {@link allocNativeZeroed}. */
export function freeNative(ptr: Deno.PointerObject): void {
  loadHeap().symbols.free(ptr);
}
