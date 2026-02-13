/**
 * Issue #1247 / #1256 - Shared WASM activation initialisation helper (internal).
 *
 * Ensures WASM activation is initialised before scoring/evaluation. Callers do not
 * call init APIs; the library initialises the backend automatically (Issue #1256).
 */
import { WasmError } from "../errors/WasmError.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "./WasmModuleLoader.ts";

/**
 * Ensures WASM activation is initialised before scoring/evaluation.
 *
 * If WASM is already available, this is a no-op. Otherwise it attempts
 * to initialise from the canonical package location. Throws if initialisation fails.
 *
 * @throws Error if WASM initialisation fails
 */
export async function ensureWasmActivation(): Promise<void> {
  if (isWasmActivationAvailable()) {
    return;
  }

  const success = await initWasmActivation();

  if (!success || !isWasmActivationAvailable()) {
    throw new WasmError(
      "WASM activation could not be loaded. Ensure the NEAT-AI package is installed correctly. " +
        "WASM activation is required.",
      "MODULE_NOT_LOADED",
    );
  }
}
