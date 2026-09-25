/**
 * Issue #4035: the `https:` branch of the WASM activation payload loader must
 * fail fast with a `WasmError` when the CDN stalls, rather than hang forever.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  fetchWasmActivationPayloadOverHttp,
  WASM_PAYLOAD_FETCH_TIMEOUT_MS,
} from "@workers/WasmActivationPayload.ts";
import { WasmError } from "@errors/WasmError.ts";

const JS_URL = new URL("https://jsr.example/pkg/wasm_activation.js");
const WASM_URL = new URL("https://jsr.example/pkg/wasm_activation_bg.wasm");

/** A peer that accepts the request and never answers until aborted. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // No signal: hang forever — the bug under test.
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

Deno.test("Issue #4035: a stalled payload fetch rejects with WasmError MODULE_NOT_LOADED", async () => {
  const err = await assertRejects(
    () =>
      fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
        fetchFn: hangingFetch,
        timeoutMs: 5,
      }),
    WasmError,
    "timed out after 5ms",
  );
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});

Deno.test("Issue #4035: every payload fetch carries an abort signal", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const recordingFetch: typeof fetch = (input, init) => {
    signals.push(init?.signal);
    const body = String(input).endsWith(".wasm")
      ? new Uint8Array([0, 97, 115, 109])
      : "export {}";
    return Promise.resolve(new Response(body));
  };
  await fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
    fetchFn: recordingFetch,
    timeoutMs: 1_000,
  });
  assertEquals(signals.length, 2);
  for (const signal of signals) {
    assertEquals(signal instanceof AbortSignal, true);
  }
});

Deno.test("Issue #4035: a healthy peer returns the JS source and WASM bytes", async () => {
  const okFetch: typeof fetch = (input) =>
    Promise.resolve(
      new Response(
        String(input).endsWith(".wasm")
          ? new Uint8Array([0, 97, 115, 109])
          : "export const glue = 1;",
      ),
    );
  const payload = await fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
    fetchFn: okFetch,
    timeoutMs: 1_000,
  });
  assertEquals(payload.jsSource, "export const glue = 1;");
  assertEquals(Array.from(payload.wasmBinary), [0, 97, 115, 109]);
});

Deno.test("Issue #4035: a non-OK response still rejects with WasmError", async () => {
  const notFound: typeof fetch = () =>
    Promise.resolve(
      new Response("missing", { status: 404, statusText: "Not Found" }),
    );
  const err = await assertRejects(
    () =>
      fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
        fetchFn: notFound,
        timeoutMs: 1_000,
      }),
    WasmError,
    "404 Not Found",
  );
  assertEquals(err.reason, "MODULE_NOT_LOADED");
});

Deno.test("Issue #4035: a network failure is wrapped in WasmError with its cause", async () => {
  const cause = new TypeError("connection reset");
  const broken: typeof fetch = () => Promise.reject(cause);
  const err = await assertRejects(
    () =>
      fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
        fetchFn: broken,
        timeoutMs: 1_000,
      }),
    WasmError,
    "connection reset",
  );
  assertEquals(err.reason, "MODULE_NOT_LOADED");
  assertEquals(err.cause, cause);
});

Deno.test("Issue #4035: an invalid timeout is refused", () => {
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(
      () =>
        fetchWasmActivationPayloadOverHttp(JS_URL, WASM_URL, {
          fetchFn: hangingFetch,
          timeoutMs,
        }),
      RangeError,
    );
  }
});

Deno.test("Issue #4035: the default timeout is a generous bound", () => {
  assertEquals(WASM_PAYLOAD_FETCH_TIMEOUT_MS, 30_000);
});
