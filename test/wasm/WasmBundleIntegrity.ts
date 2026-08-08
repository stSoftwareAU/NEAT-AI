/**
 * Issue #3680 — Runtime SHA-256 verification of the WASM activation bundle.
 *
 * The cache directory is environment-controlled
 * (`NEAT_AI_WASM_CACHE_DIR` / `XDG_CACHE_HOME` / `$HOME/.cache/neat-ai/wasm`),
 * so anyone able to write there could previously plant a `<key>.wasm` file that
 * was instantiated unchecked. These tests pin the verification contract:
 *
 *   1. a cache hit whose bytes match the pinned digest is served offline;
 *   2. a poisoned cache entry is rejected, deleted, and re-fetched;
 *   3. fetched bytes that do not match the pin hard-fail (nothing cached);
 *   4. the runtime-visible pin still describes the vendored bundle, so a core
 *      bump that forgets to regenerate it is caught here rather than as a
 *      permanent re-fetch loop in production.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  loadWasmBundleBytes,
  wasmCacheFilePath,
} from "@wasm/WasmBundleCache.ts";
import { EXPECTED_WASM_BUNDLE_SHA256 } from "@wasm/WasmBundleSha256.ts";

const BUNDLE_URL = new URL(
  "https://jsr.io/@stsoftware/neat-ai/9.9.9/wasm_activation/pkg/wasm_activation_bg.wasm",
);

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

/** Lowercase hex SHA-256 of the given bytes — the value the loader compares. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A fetch that fails the test if it is ever called. */
function denyFetch(): typeof fetch {
  return (() => {
    throw new Error("network access attempted on a verified cache hit");
  }) as unknown as typeof fetch;
}

/** A Response carrying the given bytes. */
function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200 });
}

Deno.test("WasmBundleIntegrity: cache hit with matching digest is served offline", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const genuine = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await Deno.writeFile(cachePath, genuine);

    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn: denyFetch(),
      sleepFn: noSleep,
      expectedSha256: await sha256Hex(genuine),
    });

    assertEquals(bytes, genuine, "verified cached bytes should be returned");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleIntegrity: poisoned cache entry is rejected, deleted, and re-fetched", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const genuine = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const poisoned = new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9]);
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await Deno.writeFile(cachePath, poisoned);

    let fetches = 0;
    const fetchFn = ((_url: URL) => {
      fetches++;
      return Promise.resolve(bytesResponse(genuine));
    }) as unknown as typeof fetch;

    const bytes = await loadWasmBundleBytes(BUNDLE_URL, {
      cacheDir,
      fetchFn,
      sleepFn: noSleep,
      expectedSha256: await sha256Hex(genuine),
    });

    assertEquals(bytes, genuine, "the tampered bytes must not be served");
    assertEquals(fetches, 1, "a rejected cache entry forces a fresh fetch");

    // The poisoned entry is replaced by the verified bundle, so the next start
    // is offline again rather than re-serving the tampered file.
    const persisted = await Deno.readFile(cachePath);
    assertEquals(persisted, genuine, "cache is repaired with verified bytes");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleIntegrity: poisoned cache entry is removed even when the re-fetch fails", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const genuine = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const poisoned = new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9]);
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await Deno.writeFile(cachePath, poisoned);

    const fetchFn = ((_url: URL) =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const expected = await sha256Hex(genuine);

    await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn,
          sleepFn: noSleep,
          maxAttempts: 2,
          baseDelayMs: 1,
          expectedSha256: expected,
        }),
      Error,
      "could not be fetched",
    );

    await assertRejects(
      () =>
        Deno.readFile(cachePath),
      Deno.errors.NotFound,
      undefined,
      "the poisoned cache entry must not survive the failed re-fetch",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleIntegrity: fetched bytes with the wrong digest hard-fail", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const genuine = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const substituted = new Uint8Array([0, 97, 115, 109, 4, 4, 4, 4]);
    const expected = await sha256Hex(genuine);

    const fetchFn = ((_url: URL) =>
      Promise.resolve(bytesResponse(substituted))) as unknown as typeof fetch;

    const error = await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn,
          sleepFn: noSleep,
          expectedSha256: expected,
        }),
      Error,
      "integrity check failed",
    );
    assert(
      error.message.includes(expected),
      "the error names the expected digest for operators",
    );

    // Substituted bytes are never persisted for the next start to trust.
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await assertRejects(() =>
      Deno.readFile(cachePath), Deno.errors.NotFound);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleIntegrity: an unusable expected digest fails fast", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () =>
        loadWasmBundleBytes(BUNDLE_URL, {
          cacheDir,
          fetchFn: denyFetch(),
          sleepFn: noSleep,
          expectedSha256: "not-a-digest",
        }),
      Error,
      "expected SHA-256",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmBundleIntegrity: the runtime pin matches the vendored bundle", async () => {
  const bundlePath = new URL(
    "../../wasm_activation/pkg/wasm_activation_bg.wasm",
    import.meta.url,
  );
  const actual = await sha256Hex(await Deno.readFile(bundlePath));
  assertEquals(
    EXPECTED_WASM_BUNDLE_SHA256,
    actual,
    "regenerate src/wasm/WasmBundleSha256.ts (run ./build.sh) after a core bump",
  );

  // The same digest is recorded in the build-time content manifest, so the
  // runtime pin cannot drift from the artefact build.sh verifies.
  const manifest = await Deno.readTextFile(
    new URL(
      "../../wasm_activation/pkg/content-manifest.sha256",
      import.meta.url,
    ),
  );
  const line = manifest.split("\n").find((l) =>
    l.trim().endsWith("wasm_activation_bg.wasm")
  );
  assert(line !== undefined, "content manifest must cover the WASM bundle");
  assertEquals(
    line.trim().split(/\s+/)[0],
    EXPECTED_WASM_BUNDLE_SHA256,
    "runtime pin and content manifest must agree",
  );
});
