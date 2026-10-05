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
 *
 * Issue #3680 added runtime digest verification, so each fixture declares the
 * digest of its own payload via `expectedSha256`; the integrity behaviour
 * itself is covered in `WasmBundleIntegrity.ts`.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  loadWasmBundleBytes,
  WASM_BUNDLE_FETCH_TIMEOUT_MS,
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

/** Lowercase hex SHA-256 of the given bytes — the loader's expected pin. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      expectedSha256: await sha256Hex(seeded),
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
      expectedSha256: await sha256Hex(payload),
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

Deno.test("WasmBundleCache: Issue #4048 — a fetch that never resolves (and ignores its signal) fails within the bound", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    let attempts = 0;
    const delays: number[] = [];
    const fetchFn = ((_url: URL, _init?: RequestInit) => {
      attempts++;
      // Ignores the signal entirely — the loader must still bound the wait.
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    const error = await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn,
          sleepFn: (ms) => {
            delays.push(ms);
            return Promise.resolve();
          },
          maxAttempts: 3,
          baseDelayMs: 10,
          fetchTimeoutMs: 1,
        }),
      Error,
      "timed out after 1ms",
    );

    assertEquals(attempts, 3, "should retry until the bounded attempt count");
    assertEquals(
      delays,
      [10, 20],
      "should back off between timed-out attempts",
    );
    assert(error.cause instanceof Error, "cause should be an Error");
    assert(
      (error.cause as Error).message.includes("timed out after 1ms"),
      "cause should describe the timeout",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: Issue #4048 — a body that never completes fails within the bound", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    let attempts = 0;
    const fetchFn = ((_url: URL, _init?: RequestInit) => {
      attempts++;
      const stream = new ReadableStream<Uint8Array>({
        start() {
          // Never enqueue or close — the body read must still be bounded.
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }) as unknown as typeof fetch;

    await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn,
          sleepFn: noSleep,
          maxAttempts: 2,
          baseDelayMs: 1,
          fetchTimeoutMs: 1,
        }),
      Error,
      "timed out after 1ms",
    );

    assertEquals(attempts, 2, "should stop after the bounded attempt count");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: Issue #4048 — a timed-out attempt is retried and the next attempt succeeds", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const payload = new Uint8Array([11, 22, 33, 44]);
    let attempts = 0;
    const fetchFn = ((_url: URL, _init?: RequestInit) => {
      attempts++;
      if (attempts === 1) {
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(bytesResponse(payload));
    }) as unknown as typeof fetch;

    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn,
      sleepFn: noSleep,
      maxAttempts: 2,
      baseDelayMs: 1,
      // Must outlast the healthy second attempt's arrayBuffer() read, not just
      // the first attempt's timeout, or this flakes on a loaded host.
      fetchTimeoutMs: 200,
      expectedSha256: await sha256Hex(payload),
    });

    assertEquals(
      bytes,
      payload,
      "should succeed once the timed-out attempt is retried",
    );
    assertEquals(attempts, 2, "should take two attempts");

    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    const persisted = await Deno.readFile(cachePath);
    assertEquals(persisted, payload, "fetched bundle should be persisted");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: Issue #4048 — every attempt passes an abort signal to fetchFn", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const payload = new Uint8Array([5, 6, 7]);
    let sawSignal: AbortSignal | undefined;
    const fetchFn = ((_url: URL, init?: RequestInit) => {
      sawSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(bytesResponse(payload));
    }) as unknown as typeof fetch;

    await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn,
      sleepFn: noSleep,
      expectedSha256: await sha256Hex(payload),
    });

    assert(
      sawSignal instanceof AbortSignal,
      "fetchFn should receive an AbortSignal",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: Issue #4048 — an invalid fetchTimeoutMs is refused", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const payload = new Uint8Array([1, 1, 2, 3, 5]);
    const fetchFn = ((_url: URL, _init?: RequestInit) =>
      Promise.resolve(bytesResponse(payload))) as unknown as typeof fetch;
    const expectedSha256 = await sha256Hex(payload);

    for (const invalid of [0, -1, NaN, Infinity]) {
      // deno-lint-ignore no-await-in-loop -- each case is independent/cheap; sequential keeps failures attributable.
      await assertRejects(
        () =>
          loadWasmBundleBytes(BUNDLE_URL, {
            cacheDir,
            fetchFn,
            sleepFn: noSleep,
            fetchTimeoutMs: invalid,
            expectedSha256,
          }),
        RangeError,
      );
    }

    // A valid timeout with the same setup succeeds.
    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn,
      sleepFn: noSleep,
      fetchTimeoutMs: 1000,
      expectedSha256,
    });
    assertEquals(bytes, payload);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleCache: Issue #4048 — the default bound is generous", () => {
  assertEquals(WASM_BUNDLE_FETCH_TIMEOUT_MS, 60_000);
});
