/**
 * Issue #3230 — `getWasmLoadError()` introspection.
 *
 * When the bundle loads successfully there must be no recorded load error, so
 * downstream WASM-only operations do not report a spurious cause. The capture
 * of a genuine load failure is covered by the `requireWasm` message tests
 * (`WasmTopologyOpsRequireWasm.ts`), which inject the error directly rather
 * than depend on the ambient (already-initialised) WASM state.
 */

import { assertEquals } from "@std/assert";
import { getWasmLoadError, initWasmActivation } from "@wasm/mod.ts";

Deno.test("getWasmLoadError is null after a successful load", async () => {
  const ok = await initWasmActivation();
  assertEquals(ok, true, "WASM must initialise for this test");
  assertEquals(getWasmLoadError(), null);
});
