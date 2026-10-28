/**
 * Issue #4097: the `https:` WASM activation payload loads cache-first. A warm
 * on-disk cache serves the JS glue and the WASM binary with no network access,
 * a cold cache fetches them, and every remote byte is checked against its own
 * SHA-256 pin before it is used or cached.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { WasmError } from "../../src/errors/WasmError.ts";
import {
  loadWasmActivationInitPayloadAsync,
  type WasmPayloadLoadOptions,
} from "../../src/workers/WasmActivationPayload.ts";
import { wasmCacheFilePath } from "../../src/wasm/WasmBundleCache.ts";
import { EXPECTED_WASM_GLUE_SHA256 } from "../../src/wasm/WasmBundleSha256.ts";

const BASE_URL = new URL("https://jsr.example/pkg/");
const JS_URL = new URL("wasm_activation.js", BASE_URL);
const WASM_URL = new URL("wasm_activation_bg.wasm", BASE_URL);

const GLUE_SOURCE = "export const glue = 1;";
const GENUINE_GLUE = new TextEncoder().encode(GLUE_SOURCE);
const GENUINE_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const SUBSTITUTED_GLUE = new TextEncoder().encode("export const glue = 666;");

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

/** Lowercase hex SHA-256 of the given bytes, the value the loader compares. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const GLUE_SHA256 = await sha256Hex(GENUINE_GLUE);
const WASM_SHA256 = await sha256Hex(GENUINE_WASM);

/** Load options pinned to the fixture digests, over the given cache and fetch. */
function loadOptions(
  cacheDir: string,
  fetchFn: typeof fetch,
  extra: WasmPayloadLoadOptions = {},
): WasmPayloadLoadOptions {
  return {
    baseUrl: BASE_URL,
    cacheDir,
    fetchFn,
    sleepFn: noSleep,
    expectedSha256: WASM_SHA256,
    expectedGlueSha256: GLUE_SHA256,
    ...extra,
  };
}

/** A fetch that records each requested URL, then fails as a network error would. */
function failingFetch(calls: string[]): typeof fetch {
  return ((input: URL | string) => {
    calls.push(String(input));
    return Promise.reject(new TypeError("fetch failed"));
  }) as unknown as typeof fetch;
}

/** A peer that accepts the request and never answers until aborted. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // No signal: hang forever — the bug under test.
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

/** A fetch that records each requested URL and serves the given bytes. */
function networkFetch(
  glue: Uint8Array,
  wasm: Uint8Array,
  calls: string[],
): typeof fetch {
  return ((input: URL | string) => {
    const href = String(input);
    calls.push(href);
    const body = href.endsWith(".wasm") ? wasm : glue;
    return Promise.resolve(
      new Response(body as unknown as BodyInit, { status: 200 }),
    );
  }) as unknown as typeof fetch;
}

/** Pre-populate both cache entries for the fixture payload. */
async function warmCache(
  cacheDir: string,
  glue: Uint8Array,
  wasm: Uint8Array,
): Promise<void> {
  await Deno.writeFile(await wasmCacheFilePath(JS_URL, cacheDir), glue);
  await Deno.writeFile(await wasmCacheFilePath(WASM_URL, cacheDir), wasm);
}

Deno.test("Issue #4097: a warm cache serves the payload with zero network calls", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    await warmCache(cacheDir, GENUINE_GLUE, GENUINE_WASM);

    const calls: string[] = [];
    const payload = await loadWasmActivationInitPayloadAsync(
      loadOptions(cacheDir, failingFetch(calls)),
    );

    assertEquals(payload.jsSource, GLUE_SOURCE);
    assertEquals(payload.wasmBinary, GENUINE_WASM);
    assertEquals(calls, [], "a verified warm cache must not touch the network");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: a cold cache with a failing network rejects with WasmError naming both URLs", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const err = await assertRejects(
      () =>
        loadWasmActivationInitPayloadAsync(
          loadOptions(cacheDir, failingFetch([]), { maxAttempts: 1 }),
        ),
      WasmError,
      "fetch failed",
    );

    assertEquals(err.reason, "MODULE_NOT_LOADED");
    assert(err.message.includes(JS_URL.href), "message names the glue URL");
    assert(err.message.includes(WASM_URL.href), "message names the binary URL");
    assert(
      err.cause instanceof Error && err.cause.message.includes("fetch failed"),
      "the cause carries the network failure text",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: a non-OK response on a cold cache rejects with WasmError naming the status and the URL, and nothing is cached", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const unavailableFetch: typeof fetch = () =>
      Promise.resolve(new Response("down", { status: 503 }));

    const err = await assertRejects(
      () =>
        loadWasmActivationInitPayloadAsync(
          loadOptions(cacheDir, unavailableFetch, { maxAttempts: 1 }),
        ),
      WasmError,
      "HTTP 503",
    );

    assertEquals(err.reason, "MODULE_NOT_LOADED");
    assert(err.message.includes(JS_URL.href), "message names the glue URL");
    assert(err.message.includes(WASM_URL.href), "message names the binary URL");

    const gluePath = await wasmCacheFilePath(JS_URL, cacheDir);
    const wasmPath = await wasmCacheFilePath(WASM_URL, cacheDir);
    await assertRejects(() => Deno.readFile(gluePath), Deno.errors.NotFound);
    await assertRejects(() => Deno.readFile(wasmPath), Deno.errors.NotFound);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: a cold cache fetches once, persists both entries, then serves offline", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const firstCalls: string[] = [];
    const first = await loadWasmActivationInitPayloadAsync(
      loadOptions(
        cacheDir,
        networkFetch(GENUINE_GLUE, GENUINE_WASM, firstCalls),
      ),
    );

    assertEquals(first.jsSource, GLUE_SOURCE);
    assertEquals(first.wasmBinary, GENUINE_WASM);
    assertEquals(firstCalls.length, 2, "a cold cache fetches both files");
    assertEquals(
      await Deno.readFile(await wasmCacheFilePath(JS_URL, cacheDir)),
      GENUINE_GLUE,
      "the verified glue is persisted",
    );
    assertEquals(
      await Deno.readFile(await wasmCacheFilePath(WASM_URL, cacheDir)),
      GENUINE_WASM,
      "the verified binary is persisted",
    );

    const offlineCalls: string[] = [];
    const second = await loadWasmActivationInitPayloadAsync(
      loadOptions(cacheDir, failingFetch(offlineCalls)),
    );

    assertEquals(second.jsSource, GLUE_SOURCE);
    assertEquals(second.wasmBinary, GENUINE_WASM);
    assertEquals(
      offlineCalls,
      [],
      "the persisted cache serves the next load with no network",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: a poisoned cached glue is rejected, re-fetched, and the genuine glue served", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const poisonedGlue = new TextEncoder().encode(
      "export const glue = 'pwned';",
    );
    await warmCache(cacheDir, poisonedGlue, GENUINE_WASM);

    const calls: string[] = [];
    const payload = await loadWasmActivationInitPayloadAsync(
      loadOptions(cacheDir, networkFetch(GENUINE_GLUE, GENUINE_WASM, calls)),
    );

    assertEquals(payload.jsSource, GLUE_SOURCE, "the genuine glue is served");
    assertEquals(
      calls,
      [JS_URL.href],
      "only the poisoned glue is re-fetched; the warm binary stays offline",
    );
    assertEquals(
      await Deno.readFile(await wasmCacheFilePath(JS_URL, cacheDir)),
      GENUINE_GLUE,
      "the poisoned glue entry is repaired with verified bytes",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: network glue that misses the glue pin hard-fails and is not cached", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const err = await assertRejects(
      () =>
        loadWasmActivationInitPayloadAsync(
          loadOptions(
            cacheDir,
            networkFetch(SUBSTITUTED_GLUE, GENUINE_WASM, []),
            { maxAttempts: 1 },
          ),
        ),
      WasmError,
      "integrity check failed",
    );

    assertEquals(err.reason, "MODULE_NOT_LOADED");
    const gluePath = await wasmCacheFilePath(JS_URL, cacheDir);
    await assertRejects(
      () => Deno.readFile(gluePath),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: the glue pin matches the vendored wasm_activation.js", async () => {
  const gluePath = new URL(
    "../../wasm_activation/pkg/wasm_activation.js",
    import.meta.url,
  );
  const actual = await sha256Hex(await Deno.readFile(gluePath));
  assertEquals(
    EXPECTED_WASM_GLUE_SHA256,
    actual,
    "regenerate src/wasm/WasmBundleSha256.ts (run ./build.sh) after a core bump",
  );

  // The same digest is recorded in the build-time content manifest, so the
  // glue pin cannot drift from the artefact build.sh verifies.
  const manifest = await Deno.readTextFile(
    new URL(
      "../../wasm_activation/pkg/content-manifest.sha256",
      import.meta.url,
    ),
  );
  const line = manifest.split("\n").find((l) =>
    l.trim().endsWith("wasm_activation.js")
  );
  assert(line !== undefined, "content manifest must cover the WASM glue");
  assertEquals(
    line.trim().split(/\s+/)[0],
    EXPECTED_WASM_GLUE_SHA256,
    "glue pin and content manifest must agree",
  );
});

Deno.test("Issue #4097: a stalled fetch on a cold cache rejects with WasmError (timeout bound kept, Issue #4035/#4048)", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const err = await assertRejects(
      () =>
        loadWasmActivationInitPayloadAsync(
          loadOptions(cacheDir, hangingFetch, {
            fetchTimeoutMs: 5,
            maxAttempts: 1,
          }),
        ),
      WasmError,
      "timed out after 5ms",
    );

    assertEquals(err.reason, "MODULE_NOT_LOADED");
    assert(err.message.includes(JS_URL.href), "message names the glue URL");
    assert(err.message.includes(WASM_URL.href), "message names the binary URL");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: an invalid fetch timeout is refused before any network access", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    for (
      const fetchTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]
    ) {
      const calls: string[] = [];
      // deno-lint-ignore no-await-in-loop -- each invalid value is checked in turn.
      const err = await assertRejects(
        () =>
          loadWasmActivationInitPayloadAsync(
            loadOptions(cacheDir, failingFetch(calls), { fetchTimeoutMs }),
          ),
        WasmError,
        "positive finite number",
      );

      assertEquals(err.reason, "MODULE_NOT_LOADED");
      assert(
        err.cause instanceof RangeError,
        "the RangeError is carried as the cause",
      );
      assertEquals(calls, [], "no request is made with an invalid timeout");
    }
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("Issue #4097: without an explicit glue pin the vendored glue pin applies", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const vendoredGlue = await Deno.readFile(
      new URL("../../wasm_activation/pkg/wasm_activation.js", import.meta.url),
    );
    const { expectedGlueSha256: _omitted, ...withoutGluePin } = loadOptions(
      cacheDir,
      networkFetch(vendoredGlue, GENUINE_WASM, []),
      { maxAttempts: 1 },
    );

    // The vendored glue satisfies the default pin, so it loads.
    const payload = await loadWasmActivationInitPayloadAsync(withoutGluePin);
    assertEquals(payload.jsSource, new TextDecoder().decode(vendoredGlue));

    // The fixture glue is not the vendored glue, so the default pin refuses it.
    await assertRejects(
      () =>
        loadWasmActivationInitPayloadAsync({
          ...withoutGluePin,
          fetchFn: networkFetch(GENUINE_GLUE, GENUINE_WASM, []),
          cacheDir: cacheDir + "-other",
        }),
      WasmError,
      "integrity check failed",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
    await Deno.remove(cacheDir + "-other", { recursive: true }).catch(() => {});
  }
});

Deno.test("Issue #4097: a load with an explicit baseUrl does not poison the default payload", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    await warmCache(cacheDir, GENUINE_GLUE, GENUINE_WASM);
    const isolated = await loadWasmActivationInitPayloadAsync(
      loadOptions(cacheDir, failingFetch([])),
    );
    assertEquals(isolated.jsSource, GLUE_SOURCE);

    const vendored = await Deno.readTextFile(
      new URL(
        "../../wasm_activation/pkg/wasm_activation.js",
        import.meta.url,
      ),
    );
    const defaults = await loadWasmActivationInitPayloadAsync();
    assertEquals(
      defaults.jsSource,
      vendored,
      "the default load serves the vendored glue, not the isolated load's payload",
    );
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});
