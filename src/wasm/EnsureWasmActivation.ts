/**
 * Issue #1247 - Shared WASM activation initialisation helper.
 *
 * Provides a reusable function to ensure WASM activation is initialised
 * before scoring, evaluation, or discovery operations. This avoids the
 * "WASM activation is required but not initialised" error by
 * auto-initialising when needed.
 */
import { initWasmActivation, isWasmActivationAvailable } from "./mod.ts";

/**
 * Returns the default WASM activation module path.
 *
 * The path is derived from this module's location, assuming the standard
 * repository layout where `wasm_activation/pkg` is at the project root.
 */
export function getWasmDefaultPath(): string {
  // Navigate from src/wasm/ to project root.
  // Use `href` so this works for both local `file:` and published `https:` (JSR) URLs.
  return new URL("../../wasm_activation/pkg/", import.meta.url).href
    .replace(/\/$/, "");
}

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

  const wasmPath = getWasmDefaultPath();
  const success = await initWasmActivation(wasmPath);

  if (!success || !isWasmActivationAvailable()) {
    throw new Error(
      "WASM activation must be initialised before scoring/evaluation. " +
        "Ensure the WASM module is built at wasm_activation/pkg or call " +
        "initWasmActivation() before using scoring features. " +
        "For verification only, use NEAT_AI_USE_JS_ACTIVATION=1.",
    );
  }
}
