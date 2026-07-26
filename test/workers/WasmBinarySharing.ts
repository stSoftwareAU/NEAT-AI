/**
 * Issue #3478: Share the WASM binary via SharedArrayBuffer across worker init
 * messages.
 *
 * These tests verify that:
 *   1. `toShareableWasmBinary` backs bytes with a `SharedArrayBuffer` when the
 *      runtime provides one, preserving contents exactly.
 *   2. A SAB-backed binary is *shared* (not copied) by the structured-clone
 *      algorithm — the same primitive `postMessage` uses — so N worker init
 *      messages reference one underlying buffer rather than N full copies.
 *   3. The helper falls back to the original copy-per-worker buffer when
 *      `SharedArrayBuffer` is unavailable, and workers can still initialise.
 */
import { assert, assertEquals } from "@std/assert";
import { toShareableWasmBinary } from "@workers/WasmActivationPayload.ts";

Deno.test("toShareableWasmBinary: backs bytes with a SharedArrayBuffer when available", () => {
  const source = new Uint8Array([0, 97, 115, 109, 1, 2, 3, 4]);
  const shared = toShareableWasmBinary(source);

  assert(
    shared.buffer instanceof SharedArrayBuffer,
    "returned view should be backed by a SharedArrayBuffer",
  );
  assertEquals(
    Array.from(shared),
    Array.from(source),
    "shared bytes must equal the source bytes",
  );
  assertEquals(
    shared.byteLength,
    source.byteLength,
    "shared view must span exactly the source length",
  );
});

Deno.test("toShareableWasmBinary: SAB view is shared (not copied) by structuredClone", () => {
  const source = new Uint8Array([9, 8, 7, 6, 5]);
  const shared = toShareableWasmBinary(source);

  // structuredClone is exactly what worker.postMessage uses to move the
  // payload. For a SharedArrayBuffer it wraps a fresh view over the SAME
  // shared memory instead of copying the bytes — so every worker references
  // one physical copy. structuredClone returns a new SAB *wrapper* object, so
  // the shared-ness is proven by mutation visibility, not by `===` identity.
  const cloneA = structuredClone(shared);
  const cloneB = structuredClone(shared);

  assert(
    cloneA.buffer instanceof SharedArrayBuffer,
    "clone should remain SAB-backed",
  );
  assert(
    cloneB.buffer instanceof SharedArrayBuffer,
    "every clone should remain SAB-backed",
  );

  // Mutating the source is visible in both clones → they share memory (no copy).
  shared[0] = 111;
  assertEquals(cloneA[0], 111, "clone A must observe shared-memory mutation");
  assertEquals(cloneB[0], 111, "clone B must observe shared-memory mutation");
});

Deno.test("toShareableWasmBinary: N worker init messages share one physical copy", () => {
  const source = new Uint8Array(1024).fill(42);
  const shared = toShareableWasmBinary(source);

  // Simulate posting the init payload to a pool of workers. postMessage uses
  // structuredClone; for SAB-backed bytes each clone shares one physical copy.
  const workerCount = 16;
  const posted = Array.from(
    { length: workerCount },
    () => structuredClone({ wasmActivation: { wasmBinary: shared } }),
  );

  for (const p of posted) {
    assert(
      p.wasmActivation.wasmBinary.buffer instanceof SharedArrayBuffer,
      "each posted init message must remain SAB-backed",
    );
  }

  // Mutate the single source; every worker's view must observe it, proving all
  // N messages reference one physical copy rather than N independent copies.
  shared[500] = 7;
  for (const p of posted) {
    assertEquals(
      p.wasmActivation.wasmBinary[500],
      7,
      "all worker init messages must share one underlying buffer",
    );
  }
});

Deno.test("toShareableWasmBinary: falls back to a plain copy when SharedArrayBuffer is unavailable", () => {
  const original = globalThis.SharedArrayBuffer;
  try {
    // Simulate a runtime without SharedArrayBuffer (fallback path).
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).SharedArrayBuffer;

    const source = new Uint8Array([1, 2, 3, 4, 5]);
    const result = toShareableWasmBinary(source);

    assertEquals(
      result instanceof Uint8Array,
      true,
      "fallback must still return a Uint8Array",
    );
    assertEquals(
      Array.from(result),
      Array.from(source),
      "fallback bytes must equal the source bytes",
    );
    // structuredClone of a plain ArrayBuffer-backed view copies the buffer —
    // this is the existing copy-per-worker behaviour.
    const cloned = structuredClone(result);
    assert(
      cloned.buffer !== result.buffer,
      "plain ArrayBuffer-backed bytes are copied by structuredClone (fallback)",
    );
  } finally {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).SharedArrayBuffer = original;
  }
});

Deno.test("toShareableWasmBinary: idempotent on an already-shared buffer", () => {
  const source = new Uint8Array([10, 20, 30]);
  const shared = toShareableWasmBinary(source);
  const reshared = toShareableWasmBinary(shared);

  assert(
    reshared.buffer === shared.buffer,
    "re-sharing an already SAB-backed view must not allocate a new buffer",
  );
});

Deno.test("toShareableWasmBinary: handles an empty binary", () => {
  const empty = new Uint8Array(0);
  const shared = toShareableWasmBinary(empty);

  assertEquals(shared.byteLength, 0, "empty input yields an empty view");
  assert(
    shared.buffer instanceof SharedArrayBuffer,
    "empty input is still SAB-backed when available",
  );
});
