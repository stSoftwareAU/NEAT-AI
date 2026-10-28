/**
 * Shared WASM activation payload types and loading utilities.
 *
 * Both the multithreading and intelligentDesign worker systems need to
 * bootstrap WASM activation in workers. This module provides the shared
 * payload type and loading functions as a single source of truth.
 *
 * Issue #4097: remote (`https:`) payloads load cache-first through
 * {@link loadWasmActivationPayloadCacheFirst}, which reuses the SHA-pinned
 * on-disk bundle cache in `src/wasm/WasmBundleCache.ts`. The single-shot,
 * uncached fetch {@link fetchWasmActivationPayloadOverHttp} is no longer on the
 * loader's path; it stays exported for callers that want one uncached request.
 *
 * @module
 */

import { WasmError } from "@errors/WasmError.ts";
import {
  loadWasmBundleBytes,
  type LoadWasmBundleOptions,
} from "@wasm/WasmBundleCache.ts";
import { EXPECTED_WASM_GLUE_SHA256 } from "@wasm/WasmBundleSha256.ts";

/**
 * Payload for bootstrapping WASM activation inside a worker.
 *
 * The parent thread loads these files once and sends them to workers so
 * they can initialise WASM without filesystem reads.
 */
export interface WasmActivationInitPayload {
  /**
   * The wasm-bindgen JS glue code as source text.
   * This is imported by the worker via a `data:` URL so workers don't need
   * filesystem reads to boot WASM.
   */
  jsSource: string;
  /**
   * Raw `wasm_activation_bg.wasm` bytes.
   *
   * Issue #3478: backed by a `SharedArrayBuffer` when the runtime permits, so
   * every worker's init `postMessage` shares one copy instead of
   * structured-cloning the multi-MB binary into each worker. Falls back to a
   * plain `ArrayBuffer`-backed array when `SharedArrayBuffer` is unavailable.
   */
  wasmBinary: Uint8Array;
}

let cachedPayload: WasmActivationInitPayload | null = null;
let inFlightPayload: { promise: Promise<WasmActivationInitPayload> } | null =
  null;

/**
 * Back raw WASM bytes with a `SharedArrayBuffer` so every worker references the
 * same underlying memory instead of receiving its own structured-clone copy.
 *
 * Issue #3478: `WorkerHandler` embeds the multi-MB WASM binary in each worker's
 * init message. `postMessage` structured-clones a `Uint8Array` backed by a plain
 * `ArrayBuffer`, so an N-worker pool creates N transient full copies of the
 * binary at startup. A `SharedArrayBuffer` is instead *shared* (not copied) by
 * the structured-clone algorithm, so all workers reference one copy.
 *
 * A plain `Transferable` cannot be used here: transferring detaches the buffer
 * after the first `postMessage`, but the same bytes must reach every worker.
 * `SharedArrayBuffer` is therefore the correct primitive.
 *
 * Falls back to the original copy-per-worker buffer when `SharedArrayBuffer` is
 * unavailable or its construction is rejected by the runtime (e.g. a browser
 * context without cross-origin isolation).
 *
 * @param bytes - The raw WASM binary bytes.
 * @returns A `Uint8Array` backed by a `SharedArrayBuffer` when possible, else
 *   the original `bytes` unchanged.
 */
export function toShareableWasmBinary(bytes: Uint8Array): Uint8Array {
  if (typeof SharedArrayBuffer === "undefined") return bytes;
  // Already SAB-backed (e.g. a re-shared cached payload): nothing to do.
  if (bytes.buffer instanceof SharedArrayBuffer) return bytes;
  try {
    const shared = new SharedArrayBuffer(bytes.byteLength);
    const view = new Uint8Array(shared);
    view.set(bytes);
    return view;
  } catch {
    // Construction can throw when the runtime disables SharedArrayBuffer.
    // Fail soft to the existing copy-per-worker path rather than aborting init.
    return bytes;
  }
}

/**
 * Load the WASM activation payload synchronously from the canonical package location.
 *
 * Issue #1206 - Returns null if the WASM files are not available (e.g. non-file URLs).
 *
 * @returns The WASM activation payload, or null if not available
 */
export function loadWasmActivationInitPayload():
  | WasmActivationInitPayload
  | null {
  try {
    if (cachedPayload) return cachedPayload;
    const baseUrl = new URL("../../wasm_activation/pkg/", import.meta.url);
    // Sync loader only supports filesystem reads (local checkouts).
    if (baseUrl.protocol !== "file:") return null;
    const jsSource = Deno.readTextFileSync(
      new URL("wasm_activation.js", baseUrl).pathname,
    );
    const wasmBinary = Deno.readFileSync(
      new URL("wasm_activation_bg.wasm", baseUrl).pathname,
    );
    // Issue #3478: share one copy across all workers when SAB is available.
    cachedPayload = { jsSource, wasmBinary: toShareableWasmBinary(wasmBinary) };
    return cachedPayload;
  } catch {
    return null;
  }
}

/**
 * Default bound on the single-shot WASM activation payload fetch over `https:`.
 *
 * Issue #4035: generous enough for a slow but healthy CDN, yet finite so a
 * stalled peer surfaces a `WasmError` instead of hanging worker start-up. Used
 * only by {@link fetchWasmActivationPayloadOverHttp}; the cache-first loader
 * bounds each attempt by `WASM_BUNDLE_FETCH_TIMEOUT_MS` (Issue #4048).
 */
export const WASM_PAYLOAD_FETCH_TIMEOUT_MS = 30_000;

/**
 * Options for {@link fetchWasmActivationPayloadOverHttp}, the single-shot
 * uncached fetch. The cache-first loader does not read these options.
 */
export interface WasmPayloadFetchOptions {
  /** `fetch` implementation; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Bound on both requests and their bodies, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Fetch the WASM activation JS glue and binary over HTTP(S) with a timeout.
 *
 * This is the single-shot, uncached fetch (Issue #4035): one request per file,
 * no retry, no cache. It is no longer on the path of
 * {@link loadWasmActivationInitPayloadAsync}, which loads `https:` payloads
 * cache-first through {@link loadWasmActivationPayloadCacheFirst} (Issue #4097).
 *
 * Issue #4035: one `AbortSignal.timeout` covers both requests and reading
 * their bodies, so a peer that accepts the connection and then stalls fails
 * fast. Timeouts, network failures and non-OK responses all reject with
 * `WasmError("MODULE_NOT_LOADED")`, giving callers one failure mode.
 *
 * @param jsUrl - URL of `wasm_activation.js`.
 * @param wasmUrl - URL of `wasm_activation_bg.wasm`.
 * @param options - Optional `fetch` seam and timeout override.
 * @returns The raw JS source and WASM bytes (not yet shared).
 * @throws RangeError when `timeoutMs` is not a positive finite number.
 */
export function fetchWasmActivationPayloadOverHttp(
  jsUrl: URL,
  wasmUrl: URL,
  options: WasmPayloadFetchOptions = {},
): Promise<WasmActivationInitPayload> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? WASM_PAYLOAD_FETCH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `WASM payload fetch timeout must be a positive finite number of milliseconds, got ${timeoutMs}`,
    );
  }
  return (async () => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const [jsRes, wasmRes] = await Promise.all([
        fetchFn(jsUrl.href, { signal }),
        fetchFn(wasmUrl.href, { signal }),
      ]);
      if (!jsRes.ok || !wasmRes.ok) {
        const jsErr = !jsRes.ok
          ? `${jsUrl.href}: ${jsRes.status} ${jsRes.statusText}`
          : null;
        const wasmErr = !wasmRes.ok
          ? `${wasmUrl.href}: ${wasmRes.status} ${wasmRes.statusText}`
          : null;
        // Release unread bodies so their resources are not leaked.
        await Promise.all([jsRes.body?.cancel(), wasmRes.body?.cancel()]);
        throw new WasmError(
          `WASM activation payload could not be loaded. ${
            [jsErr, wasmErr].filter(Boolean).join("; ")
          }`,
          "MODULE_NOT_LOADED",
        );
      }
      const [jsSource, wasmBuffer] = await Promise.all([
        jsRes.text(),
        wasmRes.arrayBuffer(),
      ]);
      return { jsSource, wasmBinary: new Uint8Array(wasmBuffer) };
    } catch (err) {
      if (err instanceof WasmError) throw err;
      const detail = signal.aborted
        ? `timed out after ${timeoutMs}ms`
        : err instanceof Error
        ? err.message
        : String(err);
      throw new WasmError(
        `WASM activation payload could not be loaded from ${jsUrl.href} / ${wasmUrl.href}: ${detail}`,
        "MODULE_NOT_LOADED",
        { cause: err },
      );
    }
  })();
}

/**
 * Options for {@link loadWasmActivationInitPayloadAsync} and
 * {@link loadWasmActivationPayloadCacheFirst} (Issue #4097).
 *
 * Extends {@link LoadWasmBundleOptions}, so `fetchFn`, `sleepFn`, `maxAttempts`,
 * `baseDelayMs`, `fetchTimeoutMs`, `cacheDir` and `now` apply to both files.
 */
export interface WasmPayloadLoadOptions extends LoadWasmBundleOptions {
  /**
   * Lowercase hex SHA-256 the WASM binary (`wasm_activation_bg.wasm`) must
   * match. This is the inherited {@link LoadWasmBundleOptions.expectedSha256};
   * it defaults to the generated `EXPECTED_WASM_BUNDLE_SHA256` pin.
   */
  expectedSha256?: string;
  /**
   * Lowercase hex SHA-256 the JS glue (`wasm_activation.js`) must match before
   * it is used or cached. Defaults to {@link EXPECTED_WASM_GLUE_SHA256}.
   */
  expectedGlueSha256?: string;
  /**
   * Directory the two files are resolved from; it should end in `/`. Defaults
   * to the vendored `wasm_activation/pkg/` beside this module. When set, the
   * module-level memo is neither read nor written, so the load is isolated.
   */
  baseUrl?: URL;
}

/**
 * Load the JS glue and WASM binary cache-first, each pinned by its own SHA-256
 * (Issue #4097).
 *
 * Both files go through {@link loadWasmBundleBytes} in parallel. A warm on-disk
 * cache serves them with no network access. A cache miss fetches with the
 * bounded retry and per-attempt timeout (Issue #4048). The glue is checked
 * against `expectedGlueSha256` and the binary against `expectedSha256`, so a
 * poisoned or substituted file is never returned.
 *
 * Any failure rejects with a `WasmError` (`MODULE_NOT_LOADED`) that names both
 * URLs. A failure that is already a `WasmError` is rethrown unchanged.
 *
 * @param jsUrl - URL of `wasm_activation.js`.
 * @param wasmUrl - URL of `wasm_activation_bg.wasm`.
 * @param options - Cache, fetch, retry and digest overrides.
 * @returns The decoded glue source and the WASM bytes (not yet shared).
 * @throws WasmError when either file cannot be obtained or verified.
 */
export async function loadWasmActivationPayloadCacheFirst(
  jsUrl: URL,
  wasmUrl: URL,
  options: WasmPayloadLoadOptions = {},
): Promise<WasmActivationInitPayload> {
  // Issue #4097: the glue cache entry is keyed by its own URL hash, so it shares
  // the cache directory and the `.wasm` file suffix with the binary's entry.
  // That is harmless: the key is a SHA-256 of the full URL, and each entry is
  // verified against its own pin.
  const { expectedGlueSha256, baseUrl: _baseUrl, ...wasmOptions } = options;
  try {
    const [glueBytes, wasmBinary] = await Promise.all([
      loadWasmBundleBytes(jsUrl, {
        ...wasmOptions,
        expectedSha256: expectedGlueSha256 ?? EXPECTED_WASM_GLUE_SHA256,
      }),
      loadWasmBundleBytes(wasmUrl, wasmOptions),
    ]);
    return { jsSource: new TextDecoder().decode(glueBytes), wasmBinary };
  } catch (error) {
    if (error instanceof WasmError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new WasmError(
      `WASM activation payload could not be loaded from ${jsUrl.href} / ${wasmUrl.href}: ${detail}`,
      "MODULE_NOT_LOADED",
      { cause: error },
    );
  }
}

/**
 * Async variant of loadWasmActivationInitPayload() that supports JSR `https:` URLs.
 *
 * `https:` payloads load cache-first (Issue #4097): a warm on-disk cache makes
 * no network request. `file:` payloads are read from disk.
 *
 * De-duplicates in-flight loads so multiple callers don't trigger parallel fetches.
 * The memo serves only the default location: when `options.baseUrl` is set, the
 * memo is neither read nor written, so that load is isolated.
 *
 * @param options - Optional overrides; see {@link WasmPayloadLoadOptions}.
 */
export async function loadWasmActivationInitPayloadAsync(
  options?: WasmPayloadLoadOptions,
): Promise<WasmActivationInitPayload> {
  const memoised = options?.baseUrl === undefined;
  if (memoised) {
    if (cachedPayload) return cachedPayload;
    if (inFlightPayload) {
      return await inFlightPayload.promise;
    }
  }

  const load = (async () => {
    const baseUrl = options?.baseUrl ??
      new URL("../../wasm_activation/pkg/", import.meta.url);
    const jsUrl = new URL("wasm_activation.js", baseUrl);
    const wasmUrl = new URL("wasm_activation_bg.wasm", baseUrl);

    let jsSource: string;
    let wasmBinary: Uint8Array;

    if (baseUrl.protocol === "file:") {
      jsSource = await Deno.readTextFile(jsUrl.pathname);
      wasmBinary = await Deno.readFile(wasmUrl.pathname);
    } else {
      ({ jsSource, wasmBinary } = await loadWasmActivationPayloadCacheFirst(
        jsUrl,
        wasmUrl,
        options,
      ));
    }

    // Issue #3478: share one copy across all workers when SAB is available.
    const payload = {
      jsSource,
      wasmBinary: toShareableWasmBinary(wasmBinary),
    };
    if (memoised) cachedPayload = payload;
    return payload;
  })();

  if (!memoised) return await load;

  const promise = load.finally(() => {
    inFlightPayload = null;
  });
  inFlightPayload = { promise };
  return await promise;
}

/**
 * Prefetch WASM activation in the main thread for use by workers.
 *
 * Issue #1285: Call this before spawning workers so the main thread does one fetch
 * and workers receive the cached payload instead of each worker triggering its own fetch.
 *
 * Issue #4097: the load is cache-first. A warm on-disk cache succeeds offline;
 * only a cold cache (or a rejected entry) touches the network.
 *
 * @returns Promise that resolves when the WASM payload is loaded and cached
 */
export async function fetchWasmForWorkers(): Promise<void> {
  await loadWasmActivationInitPayloadAsync();
}

/**
 * Check if the WASM activation payload is available.
 *
 * Issue #1206 - Provides a way to check WASM availability without loading
 * the full payload.
 * @returns True if the WASM files are available, false otherwise
 */
export function isWasmActivationPayloadAvailable(): boolean {
  try {
    const baseUrl = new URL("../../wasm_activation/pkg/", import.meta.url);
    if (baseUrl.protocol !== "file:") return true; // published bundles are fetchable
    const jsStat = Deno.statSync(
      new URL("wasm_activation.js", baseUrl).pathname,
    );
    const wasmStat = Deno.statSync(
      new URL("wasm_activation_bg.wasm", baseUrl).pathname,
    );
    return jsStat.isFile && wasmStat.isFile;
  } catch {
    return false;
  }
}
