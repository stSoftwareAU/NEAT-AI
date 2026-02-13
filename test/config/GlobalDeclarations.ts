import { assertEquals } from "@std/assert";
import "../../src/globals.d.ts";

Deno.test("globalThis.DEBUG is typed and accessible", () => {
  // Before setting, should be undefined
  const original = globalThis.DEBUG;

  globalThis.DEBUG = true;
  assertEquals(globalThis.DEBUG, true);

  globalThis.DEBUG = false;
  assertEquals(globalThis.DEBUG, false);

  // Restore
  globalThis.DEBUG = original;
});

Deno.test("globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT is typed and accessible", () => {
  const original = globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT;

  globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT = true;
  assertEquals(globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT, true);

  // Restore
  globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT = original;
});
