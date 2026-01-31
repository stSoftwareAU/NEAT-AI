import { initWasmActivation } from "../src/wasm/mod.ts";

/**
 * Initialise WASM activation for test suites that require it.
 */
export async function initWasmForTests(): Promise<void> {
  await initWasmActivation();
}
