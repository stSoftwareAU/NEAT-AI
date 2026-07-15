/**
 * Issue #3419 — Cache-first WASM activation bundle loading.
 *
 * These tests exercise {@link loadWasmBundleBytes} directly with an injected
 * fetch/sleep and a temporary cache directory, covering the three acceptance
 * scenarios:
 *   1. cache hit, offline — pre-seeded cache, fetch denied, zero network;
 *   2. cache miss + transient failure — first fetch rejects with a DNS-style
 *      `TypeError: fetch failed`, backoff retry succeeds, cache is written;
 *   3. cache miss + exhausted retries — all attempts fail, bounded attempts,
 *      the fetch error surfaces (fail-loud, preserved by `requireWasm`).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  loadWasmBundleBytes,
  wasmCacheFilePath,
} from "@wasm/WasmBundleCache.ts";

const BUNDLE_URL = new URL(
  "https://jsr.io/@stsoftware/neat-ai/9.9.9/wasm_activation/pkg/wasm_activation_bg.wasm",
);

/** A fetch that fails the test if it is ever called. */
function denyFetch(): typeof fetch {
  return (() => {
    throw new Error("network access attempted on a cache hit");
  }) as unknown as typeof fetch;
}

/** A Response carrying the given bytes. */
function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200 });
}

/** No-op sleep so backoff adds no real delay in tests. */
const noSleep = (_ms: number): Promise<void> => Promise.resolve();

Deno.test("WasmBundleCache: cache hit loads offline with no network", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const seeded = new Uint8Array([1, 2, 3, 4, 5]);
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await Deno.writeFile(cachePath, seeded);

    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn: denyFetch(),
      sleepFn: noSleep,
    });

    assertEquals(bytes, seeded, "cached bytes should be returned verbatim");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: cache miss retries with backoff then succeeds and caches", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const payload = new Uint8Array([9, 8, 7, 6]);
    let attempts = 0;
    const delays: number[] = [];

    const fetchFn = ((_url: URL) => {
      attempts++;
      if (attempts === 1) {
        // DNS-style transient failure on the first attempt.
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve(bytesResponse(payload));
    }) as unknown as typeof fetch;

    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn,
      sleepFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
      maxAttempts: 5,
      baseDelayMs: 10,
    });

    assertEquals(bytes, payload, "retried fetch should return the payload");
    assertEquals(attempts, 2, "should succeed on the second attempt");
    assertEquals(delays, [10], "should back off once before the retry");

    // The cache is written so the next start is offline.
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    const persisted = await Deno.readFile(cachePath);
    assertEquals(persisted, payload, "fetched bundle should be persisted");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: cache miss with exhausted retries fails loud", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    let attempts = 0;
    const fetchFn = ((_url: URL) => {
      attempts++;
      return Promise.reject(new TypeError("fetch failed"));
    }) as unknown as typeof fetch;

    const error = await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn,
          sleepFn: noSleep,
          maxAttempts: 3,
          baseDelayMs: 1,
        }),
      Error,
      "could not be fetched",
    );

    // Bounded attempts — exactly maxAttempts tries, no unbounded looping.
    assertEquals(attempts, 3, "should stop after the bounded attempt count");
    // The real network cause is attached for fail-loud diagnostics.
    assert(error.cause instanceof TypeError, "underlying cause is preserved");
    assertEquals(
      (error.cause as TypeError).message,
      "fetch failed",
      "cause carries the DNS-style fetch failure",
    );

    // Nothing was cached on a total failure.
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await assertRejects(
      () => Deno.readFile(cachePath),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: file URL reads local bundle without caching", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const local = new Uint8Array([42, 43, 44]);
    const filePath = `${dir}/wasm_activation_bg.wasm`;
    await Deno.writeFile(filePath, local);

    const bytes = await loadWasmBundleBytes(
      new URL(`file://${filePath}`),
      { fetchFn: denyFetch(), sleepFn: noSleep },
    );
    assertEquals(bytes, local, "local file bundle should load directly");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
