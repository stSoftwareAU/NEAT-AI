/**
 * Typed accessors for NEAT-AI global flags.
 *
 * JSR prohibits `declare global` type augmentation (Issue #1429). This module
 * provides explicit getter/setter helpers so the rest of the codebase can
 * access well-known `globalThis` properties without global type pollution.
 *
 * @module
 */

// deno-lint-ignore no-explicit-any
const g: Record<string, any> = globalThis as any;

/**
 * Whether the WASM auto-init at module-evaluation time should be skipped.
 *
 * Internal worker entry-points set this to `true` before importing NEAT-AI
 * modules so they can receive the WASM payload from the parent instead of
 * triggering a redundant fetch.
 */
export function getSkipWasmAutoInit(): boolean {
  return g.__NEAT_AI_SKIP_WASM_AUTO_INIT === true;
}

/** Set the skip-WASM-auto-init flag on `globalThis`. */
export function setSkipWasmAutoInit(value: boolean): void {
  g.__NEAT_AI_SKIP_WASM_AUTO_INIT = value;
}

/**
 * Read the global `DEBUG` flag (`globalThis.DEBUG`).
 *
 * Returns `false` when the flag is absent or not a boolean.
 */
export function getGlobalDebug(): boolean {
  return g.DEBUG === true;
}

/** Set the global `DEBUG` flag on `globalThis`. */
export function setGlobalDebug(value: boolean | undefined): void {
  g.DEBUG = value;
}
