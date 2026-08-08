/**
 * Cache-first WASM activation bundle loading.
 *
 * Issue #3419 / recurrence of #3230: NEAT-AI fetched its WASM activation bundle
 * (`wasm_activation/pkg/wasm_activation_bg.wasm`) from jsr.io at runtime on
 * every process start. A transient DNS/network failure at startup left the
 * bundle unloaded and later crashed breeding uncaught in
 * `WasmTopologyOps.validateTopology`.
 *
 * The bundle for a given NEAT-AI version is immutable, so the network is only
 * genuinely needed when the version changes. This module makes bundle loading
 * cache-first:
 *
 *  - The bytes are cached on disk keyed by the *versioned* bundle URL (a JSR
 *    URL embeds the package version, so a version bump changes the key).
 *  - On startup the bytes are read from that cache with **no network access**
 *    when the cached version matches the running version (cache hit).
 *  - A cache miss triggers a fetch that **retries with bounded backoff** before
 *    giving up, so a single transient DNS/network blip no longer aborts start.
 *  - Local (`file:`) builds read the vendored bundle directly — no cache, no
 *    network.
 *
 * Fail-loud (Issue #3234): if the bytes genuinely cannot be obtained, the last
 * error is thrown so the caller (`initWasmActivation`) records it and the
 * existing "requires the NEAT-AI-core WASM bundle" guard still surfaces.
 *
 * Integrity (Issue #3680): the cache directory is environment-controlled, so
 * cached bytes are untrusted. Every byte array returned from the cache or the
 * network is checked against the generated
 * {@link EXPECTED_WASM_BUNDLE_SHA256} pin before it can be instantiated — a
 * poisoned cache entry is deleted and re-fetched, and substituted network bytes
 * are a hard error.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { getLogger } from "@utils/Logger.ts";
import type { WasmBundleLoadDiagnostics } from "@wasm/WasmInitDiagnostics.ts";
import { EXPECTED_WASM_BUNDLE_SHA256 } from "@wasm/WasmBundleSha256.ts";

/** Options for {@link loadWasmBundleBytes}; all are injectable for testing. */
export interface LoadWasmBundleOptions {
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Sleep between retry attempts. Defaults to a real `setTimeout` delay. */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Maximum number of fetch attempts on a cache miss (the first try plus
   * retries). Must be at least 1. Defaults to {@link DEFAULT_MAX_ATTEMPTS}.
   */
  maxAttempts?: number;
  /** Base backoff delay in milliseconds. Defaults to {@link DEFAULT_BASE_DELAY_MS}. */
  baseDelayMs?: number;
  /**
   * Override the cache directory. When omitted it is derived from the
   * environment (`NEAT_AI_WASM_CACHE_DIR`, then the platform cache dir).
   * Pass `null` to force caching **disabled** (every start fetches) — used to
   * exercise the disabled branch deterministically in tests (Issue #3494).
   */
  cacheDir?: string | null;
  /**
   * Monotonic clock used for phase-timing measurement. Defaults to
   * `performance.now`. Injectable so tests get deterministic elapsed values
   * without real timing (Issue #3494).
   */
  now?: () => number;
  /**
   * Lowercase hex SHA-256 the bundle bytes must match before they are returned
   * (Issue #3680). Defaults to the generated {@link EXPECTED_WASM_BUNDLE_SHA256}
   * pin; injectable so tests can verify against their own fixture bytes.
   */
  expectedSha256?: string;
}

/** Bytes plus the phase-timing diagnostics for a single bundle load. */
export interface LoadWasmBundleResult {
  /** The loaded bundle bytes. */
  bytes: Uint8Array;
  /** Cache outcome, resolved directory, size, and elapsed time. */
  diagnostics: WasmBundleLoadDiagnostics;
}

/** Default bounded number of fetch attempts on a cache miss. */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Default base backoff delay in milliseconds (doubles each attempt). */
const DEFAULT_BASE_DELAY_MS = 250;

/** Real sleep used when no `sleepFn` is injected. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the base directory used to cache WASM bundles.
 *
 * Prefers `NEAT_AI_WASM_CACHE_DIR`, then the platform cache directory
 * (`XDG_CACHE_HOME`, `HOME/.cache`, or `LOCALAPPDATA` on Windows). Returns
 * `null` when no directory can be determined or environment access is denied —
 * in which case caching is skipped and loading falls back to a plain
 * fetch-with-retry.
 */
function resolveCacheDir(override?: string | null): string | null {
  if (override === null) {
    // Caller forced caching off (Issue #3494).
    return null;
  }
  if (override !== undefined && override !== "") {
    return override;
  }
  try {
    const explicit = Deno.env.get("NEAT_AI_WASM_CACHE_DIR");
    if (explicit) {
      return explicit;
    }
    const xdg = Deno.env.get("XDG_CACHE_HOME");
    if (xdg) {
      return join(xdg, "neat-ai", "wasm");
    }
    if (Deno.build.os === "windows") {
      const local = Deno.env.get("LOCALAPPDATA");
      if (local) {
        return join(local, "neat-ai", "wasm");
      }
    }
    const home = Deno.env.get("HOME");
    if (home) {
      return join(home, ".cache", "neat-ai", "wasm");
    }
  } catch {
    // Environment access denied — degrade to no caching.
  }
  return null;
}

/** Lowercase hex encoding of a byte array. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Compute the version-keyed cache file path for a bundle URL.
 *
 * The key is a SHA-256 of the full bundle URL. A JSR URL embeds the package
 * version (`.../@stsoftware/neat-ai/<version>/...`), so a version change yields
 * a different key and therefore a cache miss — exactly when a fresh fetch is
 * warranted.
 */
export async function wasmCacheFilePath(
  wasmUrl: URL,
  cacheDir: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(wasmUrl.href),
  );
  const key = toHex(new Uint8Array(digest));
  return join(cacheDir, `${key}.wasm`);
}

/** Read cached bytes, or `null` when the file is absent. Rethrows real errors. */
async function readCache(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    // A permission or IO error is not a cache miss — log and skip the cache,
    // but do not mask it as success.
    getLogger().warn(
      `WASM bundle cache: unreadable cache entry at ${path}:`,
      error,
    );
    return null;
  }
}

/**
 * Atomically write bytes to the cache. Best-effort: a write failure (e.g.
 * read-only cache dir) is logged but never fatal — the freshly-fetched bytes
 * are still returned to the caller.
 */
async function writeCache(path: string, bytes: Uint8Array): Promise<void> {
  try {
    const dir = dirname(path);
    await Deno.mkdir(dir, { recursive: true });
    // Write to a unique temp file in the same dir, then rename for atomicity.
    const tmp = await Deno.makeTempFile({ dir, suffix: ".wasm.tmp" });
    await Deno.writeFile(tmp, bytes);
    await Deno.rename(tmp, path);
  } catch (error) {
    getLogger().warn(
      `WASM bundle cache: could not persist bundle to ${path}:`,
      error,
    );
  }
}

/** Delete a rejected cache entry so the poisoned bytes cannot be served again. */
async function removeCache(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    // Not fatal — the caller re-fetches and overwrites — but never silent.
    getLogger().warn(
      `WASM bundle integrity: could not delete rejected cache entry ${path}:`,
      error,
    );
  }
}

/** Lowercase hex SHA-256 of the given bytes. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

/**
 * Resolve the digest the bundle must match, failing fast when it is unusable —
 * an absent or malformed expectation would silently disable verification.
 */
function resolveExpectedSha256(override?: string): string {
  const expected = (override ?? EXPECTED_WASM_BUNDLE_SHA256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      `WASM bundle expected SHA-256 is not a 64-character hex digest: ` +
        `"${expected}". The pin in src/wasm/WasmBundleSha256.ts is generated ` +
        `by ./build.sh — regenerate it rather than skipping verification.`,
    );
  }
  return expected;
}

/** Fetch the bundle bytes with bounded exponential backoff. Fails loud. */
async function fetchWithRetry(
  wasmUrl: URL,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop -- retries are inherently sequential.
      const response = await fetchFn(wasmUrl);
      if (!response.ok) {
        throw new Error(
          `WASM bundle fetch failed: HTTP ${response.status} for ${wasmUrl.href}`,
        );
      }
      // deno-lint-ignore no-await-in-loop -- sequential by design.
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        getLogger().warn(
          `WASM bundle fetch attempt ${attempt}/${maxAttempts} failed for ` +
            `${wasmUrl.href}; retrying in ${delay}ms:`,
          error,
        );
        // deno-lint-ignore no-await-in-loop -- backoff must pause between tries.
        await sleepFn(delay);
      }
    }
  }
  // Fail loud: surface the real network cause after exhausting retries.
  throw new Error(
    `WASM bundle could not be fetched from ${wasmUrl.href} after ` +
      `${maxAttempts} attempt(s)`,
    { cause: lastError },
  );
}

/**
 * Load the WASM activation bundle bytes, cache-first.
 *
 * - `file:` URL → read the vendored bundle directly (local build); no cache.
 * - otherwise → return cached bytes when present (no network), else
 *   fetch-with-backoff and persist to the version-keyed cache.
 *
 * @throws when the bytes genuinely cannot be obtained (fail-loud).
 */
export async function loadWasmBundleBytes(
  wasmUrl: URL,
  options: LoadWasmBundleOptions = {},
): Promise<Uint8Array> {
  return (await loadWasmBundleBytesWithDiagnostics(wasmUrl, options)).bytes;
}

/**
 * Load the WASM activation bundle bytes and report the phase-timing
 * diagnostics (Issue #3494) — cache hit/miss/disabled/local outcome, the
 * resolved cache directory, the bundle byte length, and elapsed milliseconds.
 *
 * Behaviour is identical to {@link loadWasmBundleBytes}; only the return type
 * differs so callers that want the diagnostics do not measure them twice.
 *
 * @throws when the bytes genuinely cannot be obtained (fail-loud).
 */
export async function loadWasmBundleBytesWithDiagnostics(
  wasmUrl: URL,
  options: LoadWasmBundleOptions = {},
): Promise<LoadWasmBundleResult> {
  const now = options.now ?? (() => performance.now());
  const start = now();

  // Local build: the bundle is on disk beside the JS glue. No cache/network.
  if (wasmUrl.protocol === "file:") {
    const bytes = await Deno.readFile(fromFileUrl(wasmUrl));
    return {
      bytes,
      diagnostics: {
        outcome: "local",
        cacheDir: null,
        byteLength: bytes.byteLength,
        elapsedMs: now() - start,
      },
    };
  }

  // Remote bytes (cache or network) are untrusted until they match the pin.
  const expectedSha256 = resolveExpectedSha256(options.expectedSha256);
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  const cacheDir = resolveCacheDir(options.cacheDir);
  // Explicit "caching disabled" reason so a null cache dir never reads as a
  // silent cache hit in the diagnostics (Issue #3494).
  const disabledReason = cacheDir === null
    ? "no cache directory resolved (NEAT_AI_WASM_CACHE_DIR / XDG_CACHE_HOME / " +
      "HOME unset, env access denied, or caching disabled)"
    : undefined;
  const cachePath = cacheDir === null
    ? null
    : await wasmCacheFilePath(wasmUrl, cacheDir);

  // Cache hit: return the immutable bundle with no network access — but only
  // once its digest matches the pin (Issue #3680). The cache directory is
  // environment-controlled, so a hit is a claim, not a guarantee.
  if (cachePath !== null) {
    const cached = await readCache(cachePath);
    if (cached !== null) {
      const actual = await sha256Hex(cached);
      if (actual === expectedSha256) {
        return {
          bytes: cached,
          diagnostics: {
            outcome: "hit",
            cacheDir,
            byteLength: cached.byteLength,
            elapsedMs: now() - start,
          },
        };
      }
      getLogger().error(
        `WASM bundle integrity check failed for cached bundle ${cachePath}: ` +
          `SHA-256 ${actual} does not match the expected ${expectedSha256}. ` +
          `Deleting the rejected cache entry and re-fetching ${wasmUrl.href}.`,
      );
      await removeCache(cachePath);
    }
  }

  // Cache miss, or a rejected entry: fetch with backoff, verify, then persist
  // when caching is enabled so the next start is offline.
  const bytes = await fetchWithRetry(
    wasmUrl,
    fetchFn,
    sleepFn,
    maxAttempts,
    baseDelayMs,
  );
  const fetchedSha256 = await sha256Hex(bytes);
  if (fetchedSha256 !== expectedSha256) {
    // Nothing is cached and nothing is returned: substituted bytes must never
    // reach `WebAssembly.instantiate`.
    throw new Error(
      `WASM bundle integrity check failed for ${wasmUrl.href}: SHA-256 ` +
        `${fetchedSha256} does not match the expected ${expectedSha256}`,
    );
  }
  if (cachePath !== null) {
    await writeCache(cachePath, bytes);
  }
  return {
    bytes,
    diagnostics: {
      outcome: cacheDir === null ? "disabled" : "miss",
      cacheDir,
      disabledReason,
      byteLength: bytes.byteLength,
      elapsedMs: now() - start,
    },
  };
}
