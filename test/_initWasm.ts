import { initWasmActivation } from "../src/wasm/mod.ts";

const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

/**
 * Initialise WASM activation for test suites that require it.
 */
export async function initWasmForTests(): Promise<void> {
  await initWasmActivation(wasmPath);
}
