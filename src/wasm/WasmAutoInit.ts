/**
 * WASM Auto-Initialisation
 *
 * Issue #1405 - Extracted from WasmActivation.ts as part of facade refactoring.
 * Issue #1256 - Backend is an implementation detail. No env vars required.
 * Issue #1258 - Auto-init in both main thread and workers.
 * Issue #1263 - WASM is mandatory.
 *
 * Initialises the WASM module at module load time so callers use the best
 * available backend with no code changes or env vars required. Workers that
 * use the library's own worker system receive a preloaded WASM payload from
 * the parent and set a global flag to skip auto-init.
 */

import { getSkipWasmAutoInit } from "../globalAccessors.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "./WasmModuleLoader.ts";

/**
 * Detect whether we are running in a Worker scope.
 */
export function isProbablyWorkerScope(): boolean {
  try {
    // deno-lint-ignore no-explicit-any
    const g: any = globalThis;
    if (typeof g.DedicatedWorkerGlobalScope === "function") {
      return g instanceof g.DedicatedWorkerGlobalScope;
    }
  } catch {
    // Ignore
  }

  // deno-lint-ignore no-explicit-any
  const g: any = globalThis;
  const hasDocument = typeof g.document !== "undefined";
  const hasPostMessage = typeof g.postMessage === "function";
  const hasClose = typeof g.close === "function";
  const hasOnMessage = typeof g.onmessage !== "undefined";
  return !hasDocument && hasPostMessage && hasClose && hasOnMessage;
}

// ---------------------------------------------------------------------------
// Auto-initialisation
// ---------------------------------------------------------------------------

try {
  const shouldAutoInit = !isWasmActivationAvailable() &&
    !getSkipWasmAutoInit();

  if (shouldAutoInit) {
    await initWasmActivation();
  }
} catch {
  // Ignore env permission errors; auto-init stays disabled.
}
