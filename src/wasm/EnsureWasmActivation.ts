/**
 * Issue #1247 / #1256 - Shared WASM activation initialisation helper (internal).
 *
 * Ensures WASM activation is initialised before scoring/evaluation. Callers do not
 * call init APIs; the library initialises the backend automatically (Issue #1256).
 */
import { initWasmActivation, isWasmActivationAvailable } from "./mod.ts";

/**
 * Ensures WASM activation is initialised before scoring/evaluation.
 *
 * If WASM is already available, this is a no-op. Otherwise it attempts
 * to initialise from the default path. Throws if initialisation fails
 * and `NEAT_AI_USE_JS_ACTIVATION` is not set.
 *
 * @throws Error if WASM initialisation fails and JS fallback is not enabled
 */
export async function ensureWasmActivation(): Promise<void> {
  if (isWasmActivationAvailable()) {
    return;
  }

  const success = await initWasmActivation();

  if (!success || !isWasmActivationAvailable()) {
    throw new Error(
      "WASM activation could not be loaded. Ensure the NEAT-AI package is installed correctly. " +
        "For verification-only mode, set NEAT_AI_USE_JS_ACTIVATION=1 (optional, debug only).",
    );
  }
}
