/**
 * Shared WASM initialisation logic for worker processors.
 *
 * Both the multithreading and intelligentDesign WorkerProcessor classes
 * need identical WASM bootstrap logic. This module provides it as a
 * single source of truth.
 *
 * Issue #1600: Extracted from duplicated code in both worker processors.
 *
 * @module
 */

import { WasmError } from "../errors/WasmError.ts";
import {
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "../wasm/mod.ts";
import type { WasmActivationInitPayload } from "./WasmActivationPayload.ts";

/**
 * Initialises WASM activation from a parent-supplied payload.
 *
 * This function is idempotent: if WASM is already initialised, it returns
 * immediately. If the sync init fails (e.g. because an async auto-init
 * is in-flight), it polls briefly before failing.
 *
 * @param payload - The WASM activation payload from the parent thread
 * @param wasmRequired - When true, throws if no payload is provided
 * @returns A tracking object with `wasmInitAttempted` set to true
 */
export async function initialiseWasmActivationFromPayload(
  payload: WasmActivationInitPayload | undefined,
  wasmRequired: boolean,
): Promise<void> {
  if (isWasmActivationAvailable()) return;

  if (!payload) {
    if (wasmRequired) {
      throw new WasmError(
        "Worker WASM activation payload missing (WASM is required). " +
          "Call fetchWasmForWorkers() before spawning workers, or ensure the NEAT-AI " +
          "package includes `wasm_activation/pkg`.",
        "MODULE_NOT_LOADED",
      );
    }
    return;
  }

  // Import wasm-bindgen glue from the provided source to avoid file reads.
  const jsModuleUrl = `data:application/javascript;charset=utf-8,${
    encodeURIComponent(payload.jsSource)
  }`;
  const jsBindings = await import(jsModuleUrl);

  const ok = initWasmActivationSync(jsBindings, payload.wasmBinary);
  if (ok) return;

  // Defensive: if an async auto-init is in flight (e.g. env-driven module-load init),
  // the sync init intentionally fails fast to avoid re-entrancy into wasm-bindgen.
  // In that case, wait briefly for the in-flight init to finish before failing.
  // Issue #1260: WASM is built in-repo and published; use short deadline to fail fast.
  const deadlineMs = Date.now() + 2_000;
  while (Date.now() < deadlineMs) {
    if (isWasmActivationAvailable()) return;
    // deno-lint-ignore no-await-in-loop -- deliberate polling backoff
    await new Promise((r) => setTimeout(r, 50));
  }

  if (isWasmActivationAvailable()) return;
  throw new WasmError(
    "Worker WASM activation init failed",
    "MODULE_NOT_LOADED",
  );
}
