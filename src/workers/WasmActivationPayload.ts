/**
 * Shared WASM activation payload types and loading utilities.
 *
 * Both the multithreading and intelligentDesign worker systems need to
 * bootstrap WASM activation in workers. This module provides the shared
 * payload type and loading functions as a single source of truth.
 *
 * @module
 */

import { WasmError } from "@errors/WasmError.ts";

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
  /** Raw `wasm_activation_bg.wasm` bytes. */
  wasmBinary: Uint8Array;
}

let cachedPayload: WasmActivationInitPayload | null = null;
let inFlightPayload: { promise: Promise<WasmActivationInitPayload> } | null =
  null;

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
    cachedPayload = { jsSource, wasmBinary };
    return cachedPayload;
  } catch {
    return null;
  }
}

/**
 * Async variant of loadWasmActivationInitPayload() that supports JSR `https:` URLs.
 *
 * De-duplicates in-flight loads so multiple callers don't trigger parallel fetches.
 */
export async function loadWasmActivationInitPayloadAsync(): Promise<
  WasmActivationInitPayload
> {
  if (cachedPayload) return cachedPayload;
  if (inFlightPayload) {
    return await inFlightPayload.promise;
  }

  const promise = (async () => {
    const baseUrl = new URL("../../wasm_activation/pkg/", import.meta.url);
    const jsUrl = new URL("wasm_activation.js", baseUrl);
    const wasmUrl = new URL("wasm_activation_bg.wasm", baseUrl);

    let jsSource: string;
    let wasmBinary: Uint8Array;

    if (baseUrl.protocol === "file:") {
      jsSource = await Deno.readTextFile(jsUrl.pathname);
      wasmBinary = await Deno.readFile(wasmUrl.pathname);
    } else {
      const [jsRes, wasmRes] = await Promise.all([
        fetch(jsUrl.href),
        fetch(wasmUrl.href),
      ]);
      if (!jsRes.ok || !wasmRes.ok) {
        const jsErr = !jsRes.ok
          ? `${jsUrl.href}: ${jsRes.status} ${jsRes.statusText}`
          : null;
        const wasmErr = !wasmRes.ok
          ? `${wasmUrl.href}: ${wasmRes.status} ${wasmRes.statusText}`
          : null;
        throw new WasmError(
          `WASM activation payload could not be loaded. ${
            [jsErr, wasmErr].filter(Boolean).join("; ")
          }`,
          "MODULE_NOT_LOADED",
        );
      }
      jsSource = await jsRes.text();
      wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
    }

    cachedPayload = { jsSource, wasmBinary };
    return cachedPayload;
  })().finally(() => {
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
