/**
 * Issue #2545 — Documented JSR-worker WASM bootstrap surface.
 *
 * The TROUBLESHOOTING guide tells consumers to defeat
 * `NotCapable: Requires net access to "jsr.io:443"` inside their own Deno
 * Workers by:
 *
 *   1. Calling `fetchWasmForWorkers()` (or `loadWasmActivationInitPayloadAsync()`)
 *      in the parent — which has `--allow-net`.
 *   2. Forwarding the resulting `WasmActivationInitPayload` to the worker.
 *   3. Calling `initialiseWasmActivationFromPayload()` inside the worker — no
 *      `fetch(URL)` and therefore no `net` permission required.
 *
 * The docs only work if every helper named above remains exported from the
 * package's public entry point (`mod.ts`). This test pins that contract:
 * any future refactor that hides one of the helpers fails here, before
 * consumers hit a broken JSR import.
 *
 * It also exercises the in-process equivalent of the parent → worker handoff
 * to make sure the helpers wire together correctly.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import * as publicApi from "../../mod.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";

Deno.test("Issue #2545: documented JSR-worker helpers are exported from mod.ts", () => {
  // The TROUBLESHOOTING.md example imports these three symbols by name from
  // "@stsoftware/neat-ai". They must be present on the public surface.
  assertEquals(typeof publicApi.fetchWasmForWorkers, "function");
  assertEquals(typeof publicApi.loadWasmActivationInitPayloadAsync, "function");
  assertEquals(
    typeof publicApi.initialiseWasmActivationFromPayload,
    "function",
  );
});

Deno.test("Issue #2545: parent loads the payload and worker boot helper accepts it", async () => {
  // Parent-side step in the documented pattern.
  const payload = await publicApi.loadWasmActivationInitPayloadAsync();
  assertExists(
    payload,
    "loadWasmActivationInitPayloadAsync must return a payload",
  );
  assert(
    payload.jsSource.length > 0,
    "wasm-bindgen JS glue must be non-empty so the worker can data:URL-import it",
  );
  assert(
    payload.wasmBinary.byteLength > 0,
    "WASM bytes must be non-empty so the worker can call initWasmActivationSync()",
  );

  // Worker-side step. WASM is already initialised by the test harness, so this
  // call returns idempotently — the contract we depend on for the documented
  // pattern is that the helper does not throw when invoked with a valid payload.
  await publicApi.initialiseWasmActivationFromPayload(payload, true);
  assertEquals(isWasmActivationAvailable(), true);
});

Deno.test("Issue #2545: payload is JSON-postMessage friendly (no functions, no host objects)", async () => {
  // The documented pattern relies on `worker.postMessage(payload)` carrying
  // the bytes across the structured-clone boundary unchanged. Validate that
  // the payload only contains string + Uint8Array fields.
  const payload = await publicApi.loadWasmActivationInitPayloadAsync();
  assertEquals(typeof payload.jsSource, "string");
  assert(
    payload.wasmBinary instanceof Uint8Array,
    "wasmBinary must be a Uint8Array so structured-clone preserves the bytes",
  );
});
