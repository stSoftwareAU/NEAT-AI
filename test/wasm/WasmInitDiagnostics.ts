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
  splitHandshakeObservation,
  WASM_WORKER_INIT_LOG_PREFIX,
  type WasmActivationInitDiagnostics,
} from "@wasm/WasmInitDiagnostics.ts";

const BUNDLE_URL = new URL(
  "https://jsr.io/@stsoftware/neat-ai/9.9.9/wasm_activation/pkg/wasm_activation_bg.wasm",
);

/**
 * Lowercase hex SHA-256 of the given bytes. Issue #3680 made the loader verify
 * every remote/cached bundle against a pinned digest, so these fixtures declare
 * the digest of their own payload.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
        expectedSha256: await sha256Hex(seeded),
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
      {
        cacheDir,
        fetchFn,
        sleepFn: noSleep,
        now: fakeClock([0, 42]),
        expectedSha256: await sha256Hex(payload),
      },
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
    {
      cacheDir: null,
      fetchFn,
      sleepFn: noSleep,
      now: fakeClock([0, 7]),
      expectedSha256: await sha256Hex(payload),
    },
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

  // Preserved phrase so existing operator greps keep matching.
  assertStringIncludes(message, "no response after 60s");
  // The greppable prefix and parent-observed breakdown.
  assertStringIncludes(message, WASM_WORKER_INIT_LOG_PREFIX);
  assertStringIncludes(message, "worker=worker-3");
  // GRQ #4238: 60,001 ms observed against a 60,000 ms deadline is a 60,000 ms
  // handshake plus 1 ms of timer jitter — never a 60,001 ms handshake.
  assertStringIncludes(message, "handshakeMs=60000");
  assertStringIncludes(message, "parentStallMs=1");
  assertStringIncludes(message, "wasm[cache=hit");
  assertStringIncludes(message, "bundleBytes=1234567");
  assertStringIncludes(message, `workerError=${JSON.stringify("boom")}`);
  // Child phases are explicitly unknown, not reported as zero.
  assertStringIncludes(message, "Child WASM phase timings unknown");
});

Deno.test("WasmInitDiagnostics #4238: handshakeMs never exceeds the deadline", () => {
  // The GRQ-13 reading: 14m 55s reported against a 60s timeout.
  const message = formatWorkerInitTimeout({
    workerLabel: "worker-114",
    timeoutMs: 60_000,
    elapsedMs: 895_250,
    wasm: null,
    loopBlockedMs: 0,
    spawnToInitMs: 12,
  });

  assertStringIncludes(message, "handshakeMs=60000");
  assertStringIncludes(message, "parentStallMs=835250");
  assertStringIncludes(message, "spawnToInitMs=12");
  assert(
    !message.includes("handshakeMs=895250"),
    "the parent's own stall must not be reported as handshake time",
  );
});

Deno.test("WasmInitDiagnostics #4238: a stalled parent is not evidence about the child", () => {
  const message = formatWorkerInitTimeout({
    workerLabel: "worker-114",
    timeoutMs: 60_000,
    elapsedMs: 895_250,
    wasm: null,
    loopBlockedMs: 0,
  });

  assertStringIncludes(message, "The parent's own event loop stalled");
  assertStringIncludes(message, "not evidence about the child");
  // With the parent blind, the candidate list is honest again — and the
  // long-standing operator grep still matches.
  assertStringIncludes(message, "stuck loading WASM");
  assert(
    !message.includes("did not reach its entry point"),
    "a blocked parent must not blame the child for the silence",
  );
});

Deno.test("WasmInitDiagnostics #4238: a block inside the window is caught without overshoot", () => {
  // The timer fired on time, but the loop was blocked for 40s of the window.
  const message = formatWorkerInitTimeout({
    workerLabel: "worker-7",
    timeoutMs: 60_000,
    elapsedMs: 60_000,
    wasm: null,
    loopBlockedMs: 40_000,
  });

  assertStringIncludes(message, "handshakeMs=60000");
  assertStringIncludes(message, "parentStallMs=0");
  assertStringIncludes(message, "loopBlockedMs=40000");
  assertStringIncludes(message, "not evidence about the child");
});

Deno.test("WasmInitDiagnostics #4238: a received heartbeat still convicts the child", () => {
  const message = formatWorkerInitTimeout({
    workerLabel: "worker-7",
    timeoutMs: 60_000,
    elapsedMs: 895_250,
    wasm: null,
    heartbeatMs: 37,
    loopBlockedMs: 0,
  });

  // Positive evidence survives a parent stall: the heartbeat did arrive.
  assertStringIncludes(message, "heartbeat=received heartbeatMs=37");
  assertStringIncludes(message, "The parent's own event loop stalled");
  assertStringIncludes(message, "then stalled before answering");
});

Deno.test("WasmInitDiagnostics #4238: splitHandshakeObservation caps and attributes", () => {
  const stalled = splitHandshakeObservation(895_250, 60_000, 0);
  assertEquals(stalled.handshakeMs, 60_000);
  assertEquals(stalled.parentStallMs, 835_250);
  assertEquals(stalled.parentStalled, true);

  // Ordinary timer jitter is not a stall.
  const jitter = splitHandshakeObservation(60_001, 60_000, 3);
  assertEquals(jitter.handshakeMs, 60_000);
  assertEquals(jitter.parentStallMs, 1);
  assertEquals(jitter.parentStalled, false);

  // An in-window block with no overshoot is still a stall.
  const blocked = splitHandshakeObservation(60_000, 60_000, 40_000);
  assertEquals(blocked.parentStallMs, 0);
  assertEquals(blocked.parentStalled, true);

  // A handshake that ended early (an error raced the deadline) is untouched.
  const early = splitHandshakeObservation(1_200, 60_000, 0);
  assertEquals(early.handshakeMs, 1_200);
  assertEquals(early.parentStallMs, 0);

  // Degenerate readings never produce a negative or NaN field.
  const degenerate = splitHandshakeObservation(Number.NaN, 60_000);
  assertEquals(degenerate.handshakeMs, 0);
  assertEquals(degenerate.parentStallMs, 0);
  assertEquals(splitHandshakeObservation(-5, 60_000).handshakeMs, 0);
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
