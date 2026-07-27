/**
 * Issue #3494 — Init-phase timing diagnostics for WASM/worker startup.
 *
 * These tests pin the timing/format **contract** that makes a worker-init
 * timeout diagnosable:
 *
 *   1. {@link loadWasmBundleBytesWithDiagnostics} reports the cache
 *      hit/miss/disabled/local outcome, the resolved cache directory, the
 *      bundle byte length, and elapsed ms — driven through the injectable
 *      `fetchFn` / `sleepFn` / `cacheDir` / `now` options.
 *   2. The greppable log-line formatters ({@link formatWorkerInitDiagnostics},
 *      {@link formatWorkerInitTimeout}) emit the fixed prefix and field keys
 *      GRQ health tooling matches on, including the "child phases unknown"
 *      case on the timeout path.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  loadWasmBundleBytesWithDiagnostics,
  wasmCacheFilePath,
} from "@wasm/WasmBundleCache.ts";
import {
  formatWorkerInitDiagnostics,
  formatWorkerInitTimeout,
  getLastWasmActivationInitDiagnostics,
  recordWasmActivationInitDiagnostics,
  resetWasmActivationInitDiagnostics,
  WASM_WORKER_INIT_LOG_PREFIX,
  type WasmActivationInitDiagnostics,
} from "@wasm/WasmInitDiagnostics.ts";

const BUNDLE_URL = new URL(
  "https://jsr.io/@stsoftware/neat-ai/9.9.9/wasm_activation/pkg/wasm_activation_bg.wasm",
);

/** A monotonic clock returning a fixed sequence of values (deterministic ms). */
function fakeClock(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** A Response carrying the given bytes. */
function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200 });
}

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

/** A fetch that fails the test if it is ever called. */
function denyFetch(): typeof fetch {
  return (() => {
    throw new Error("network access attempted on a cache hit");
  }) as unknown as typeof fetch;
}

Deno.test("WasmInitDiagnostics: cache hit reports outcome/dir/bytes/elapsed", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const seeded = new Uint8Array([1, 2, 3, 4, 5]);
    const cachePath = await wasmCacheFilePath(BUNDLE_URL, cacheDir);
    await Deno.writeFile(cachePath, seeded);

    const { bytes, diagnostics } = await loadWasmBundleBytesWithDiagnostics(
      BUNDLE_URL,
      {
        cacheDir,
        fetchFn: denyFetch(),
        sleepFn: noSleep,
        now: fakeClock([100, 103]),
      },
    );

    assertEquals(bytes, seeded);
    assertEquals(diagnostics.outcome, "hit");
    assertEquals(diagnostics.cacheDir, cacheDir);
    assertEquals(diagnostics.byteLength, 5);
    assertEquals(diagnostics.elapsedMs, 3);
    assertEquals(diagnostics.disabledReason, undefined);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmInitDiagnostics: cache miss fetches, persists, reports miss", async () => {
  const cacheDir = await Deno.makeTempDir();
  try {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const fetchFn = ((_url: URL) =>
      Promise.resolve(bytesResponse(payload))) as unknown as typeof fetch;

    const { bytes, diagnostics } = await loadWasmBundleBytesWithDiagnostics(
      BUNDLE_URL,
      { cacheDir, fetchFn, sleepFn: noSleep, now: fakeClock([0, 42]) },
    );

    assertEquals(bytes, payload);
    assertEquals(diagnostics.outcome, "miss");
    assertEquals(diagnostics.cacheDir, cacheDir);
    assertEquals(diagnostics.byteLength, 4);
    assertEquals(diagnostics.elapsedMs, 42);

    // The miss persisted the bundle for the next (offline) start.
    const persisted = await Deno.readFile(
      await wasmCacheFilePath(BUNDLE_URL, cacheDir),
    );
    assertEquals(persisted, payload);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("WasmInitDiagnostics: caching disabled fetches and reports a reason", async () => {
  const payload = new Uint8Array([1, 1, 2, 3, 5]);
  let attempts = 0;
  const fetchFn = ((_url: URL) => {
    attempts++;
    return Promise.resolve(bytesResponse(payload));
  }) as unknown as typeof fetch;

  const { bytes, diagnostics } = await loadWasmBundleBytesWithDiagnostics(
    BUNDLE_URL,
    // cacheDir: null forces the disabled branch deterministically.
    { cacheDir: null, fetchFn, sleepFn: noSleep, now: fakeClock([0, 7]) },
  );

  assertEquals(bytes, payload);
  assertEquals(attempts, 1, "disabled caching still fetches exactly once");
  assertEquals(diagnostics.outcome, "disabled");
  assertEquals(diagnostics.cacheDir, null);
  assertEquals(diagnostics.byteLength, 5);
  assertEquals(diagnostics.elapsedMs, 7);
  assert(
    diagnostics.disabledReason && diagnostics.disabledReason.length > 0,
    "disabled outcome carries an explicit reason",
  );
});

Deno.test("WasmInitDiagnostics: file URL reports the local outcome", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const local = new Uint8Array([42, 43, 44]);
    const filePath = `${dir}/wasm_activation_bg.wasm`;
    await Deno.writeFile(filePath, local);

    const { bytes, diagnostics } = await loadWasmBundleBytesWithDiagnostics(
      new URL(`file://${filePath}`),
      { fetchFn: denyFetch(), sleepFn: noSleep, now: fakeClock([5, 9]) },
    );

    assertEquals(bytes, local);
    assertEquals(diagnostics.outcome, "local");
    assertEquals(diagnostics.cacheDir, null);
    assertEquals(diagnostics.byteLength, 3);
    assertEquals(diagnostics.elapsedMs, 4);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const SAMPLE_WASM: WasmActivationInitDiagnostics = {
  bundle: {
    outcome: "hit",
    cacheDir: "/home/u/.cache/neat-ai/wasm",
    byteLength: 1234567,
    elapsedMs: 3,
  },
  glueImportMs: 12,
  instantiateMs: 27,
  totalMs: 42,
};

Deno.test("WasmInitDiagnostics: info line carries the greppable contract", () => {
  const line = formatWorkerInitDiagnostics({
    workerLabel: "worker-3",
    handshakeMs: 42.4,
    wasm: SAMPLE_WASM,
  });

  assertStringIncludes(line, `${WASM_WORKER_INIT_LOG_PREFIX} worker=worker-3`);
  assertStringIncludes(line, "outcome=ok");
  assertStringIncludes(line, "handshakeMs=42");
  assertStringIncludes(line, "cache=hit");
  assertStringIncludes(line, "cacheDir=/home/u/.cache/neat-ai/wasm");
  assertStringIncludes(line, "bundleBytes=1234567");
  assertStringIncludes(line, "bundleLoadMs=3");
  assertStringIncludes(line, "glueImportMs=12");
  assertStringIncludes(line, "instantiateMs=27");
  assertStringIncludes(line, "wasmTotalMs=42");
  assertStringIncludes(line, "workerError=none");
});

Deno.test("WasmInitDiagnostics: info line marks unmeasured WASM phases with ?", () => {
  const line = formatWorkerInitDiagnostics({
    workerLabel: "worker-9",
    handshakeMs: 5,
    wasm: null,
  });

  assertStringIncludes(line, "cache=unknown");
  assertStringIncludes(line, "bundleBytes=?");
  assertStringIncludes(line, "bundleLoadMs=?");
  assertStringIncludes(line, "wasmTotalMs=?");
});

Deno.test("WasmInitDiagnostics: timeout message embeds the parent-observed breakdown", () => {
  const message = formatWorkerInitTimeout({
    workerLabel: "worker-3",
    timeoutMs: 60_000,
    elapsedMs: 60_001,
    wasm: SAMPLE_WASM,
    workerError: new Error("boom"),
  });

  // Preserved phrases so existing operator greps keep matching.
  assertStringIncludes(message, "no response after 60s");
  assertStringIncludes(message, "stuck loading WASM");
  // The greppable prefix and parent-observed breakdown.
  assertStringIncludes(message, WASM_WORKER_INIT_LOG_PREFIX);
  assertStringIncludes(message, "worker=worker-3");
  assertStringIncludes(message, "handshakeMs=60001");
  assertStringIncludes(message, "wasm[cache=hit");
  assertStringIncludes(message, "bundleBytes=1234567");
  assertStringIncludes(message, `workerError=${JSON.stringify("boom")}`);
  // Child phases are explicitly unknown, not reported as zero.
  assertStringIncludes(message, "Child WASM phase timings unknown");
});

Deno.test("WasmInitDiagnostics: timeout message flags unmeasured WASM explicitly", () => {
  const message = formatWorkerInitTimeout({
    workerLabel: "episode-worker-1",
    timeoutMs: 30_000,
    elapsedMs: 30_000,
    wasm: null,
  });

  assertStringIncludes(message, "no response after 30s");
  assertStringIncludes(message, "wasm[not-measured]");
  assertStringIncludes(message, "workerError=none");
});

Deno.test("WasmInitDiagnostics: record/get/reset round-trips the last diagnostics", () => {
  resetWasmActivationInitDiagnostics();
  assertEquals(getLastWasmActivationInitDiagnostics(), null);

  recordWasmActivationInitDiagnostics(SAMPLE_WASM);
  assertEquals(getLastWasmActivationInitDiagnostics(), SAMPLE_WASM);

  resetWasmActivationInitDiagnostics();
  assertEquals(getLastWasmActivationInitDiagnostics(), null);
});
