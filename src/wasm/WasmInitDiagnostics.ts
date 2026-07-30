/**
 * WASM / worker init-phase timing diagnostics (Issue #3494).
 *
 * When a discovery-replay (or any pooled) worker fails to answer its init
 * handshake within the 60s deadline (`NEAT_AI_WORKER_INIT_TIMEOUT_MS`), the
 * old error — "no response after 60s. Worker may have crashed or be stuck
 * loading WASM." — was a *guess*, not a *measurement*. This module is the
 * single source of truth for the timing/format contract that makes the stall
 * diagnosable, without changing the self-healing fallback behaviour.
 *
 * ## The greppable log-line contract
 *
 * GRQ health tooling (`discovery_worker_fallback_health.sh`) matches on fixed
 * substrings, so the shape below is a **contract** — keep the prefix and field
 * keys stable. Two line shapes share the {@link WASM_WORKER_INIT_LOG_PREFIX}
 * prefix so both are greppable:
 *
 * 1. **Normal path** — one compact `info`-level line per worker init (always
 *    on, never behind a debug flag):
 *
 *    ```text
 *    [WasmWorkerInit] worker=worker-3 outcome=ok handshakeMs=42 cache=hit \
 *      cacheDir=/home/u/.cache/neat-ai/wasm bundleBytes=1234567 bundleLoadMs=3 \
 *      glueImportMs=12 instantiateMs=27 wasmTotalMs=42 workerError=none
 *    ```
 *
 * 2. **Timeout path** — the phase breakdown is embedded in the *thrown error
 *    message*, so it lands after the trailing `Error:` token of the
 *    `[…] Worker init failed …` log line and flows into GRQ's `firstError=`
 *    field with no extra plumbing:
 *
 *    ```text
 *    [WasmWorkerInit] Worker init: no response after 60s (worker=worker-3). \
 *      Parent-observed: handshakeMs=60001 workerError=none heartbeat=none \
 *      wasm[cache=hit …]. Child WASM phase timings unknown — the worker never \
 *      answered … The child never sent its start heartbeat …
 *    ```
 *
 *    `heartbeat=received heartbeatMs=N` / `heartbeat=none` (Issue #3771) is
 *    the field that separates a child which started and then stalled from one
 *    that never started at all.
 *
 * The phrases "no response after Ns" and "stuck loading WASM" are preserved so
 * existing operator greps keep matching.
 *
 * The WASM phases (bundle cache resolve/read, wasm-bindgen glue import, and
 * `WebAssembly.instantiate`) are measured on the **parent/main thread** by
 * `initWasmActivation` and stashed here via
 * {@link recordWasmActivationInitDiagnostics}. On a handshake timeout the
 * *child's* internal phases are unknowable — the worker never answered — so the
 * timeout line reports only what the parent can see and says so explicitly,
 * rather than printing zeros that read as "instant".
 *
 * @module
 */

/** Fixed, greppable prefix shared by the info line and the timeout error. */
export const WASM_WORKER_INIT_LOG_PREFIX = "[WasmWorkerInit]";

/**
 * Outcome of resolving/reading the cached WASM bundle:
 *
 * - `hit` — bytes served from the version-keyed on-disk cache (no network);
 * - `miss` — cache directory resolved but empty, so bytes were fetched and
 *   then persisted for the next start;
 * - `disabled` — no cache directory could be resolved (env access denied, no
 *   `HOME`, or caching switched off), so *every* start hits the network;
 * - `local` — a `file:` build read the vendored bundle directly (no cache,
 *   no network).
 */
export type WasmBundleCacheOutcome = "hit" | "miss" | "disabled" | "local";

/** Timing + outcome for the bundle cache-resolve/read phase. */
export interface WasmBundleLoadDiagnostics {
  /** How the bundle bytes were obtained. */
  outcome: WasmBundleCacheOutcome;
  /** The resolved cache directory, or `null` when caching is disabled/local. */
  cacheDir: string | null;
  /** Human-readable reason caching was skipped (only set when disabled). */
  disabledReason?: string;
  /** Bundle size in bytes, or a negative sentinel when not observed. */
  byteLength: number;
  /** Wall-clock spent in the bundle-load phase, in milliseconds. */
  elapsedMs: number;
}

/** Per-phase timings for a single main-thread WASM activation init. */
export interface WasmActivationInitDiagnostics {
  /** Bundle cache resolve/read phase. */
  bundle: WasmBundleLoadDiagnostics;
  /** Milliseconds spent `import()`ing the wasm-bindgen JS glue. */
  glueImportMs: number;
  /** Milliseconds spent in `module.default()` (compile + instantiate). */
  instantiateMs: number;
  /** Total milliseconds across all three phases. */
  totalMs: number;
}

let lastInitDiagnostics: WasmActivationInitDiagnostics | null = null;

/**
 * Record the phase timings from the most recent main-thread WASM activation
 * init. Called by `initWasmActivation`; read by the worker init sequence.
 */
export function recordWasmActivationInitDiagnostics(
  diagnostics: WasmActivationInitDiagnostics,
): void {
  lastInitDiagnostics = diagnostics;
}

/**
 * The phase timings from the most recent successful main-thread WASM
 * activation init, or `null` when WASM was never initialised on this thread.
 */
export function getLastWasmActivationInitDiagnostics():
  | WasmActivationInitDiagnostics
  | null {
  return lastInitDiagnostics;
}

/** Clears the recorded diagnostics. Intended for test isolation. */
export function resetWasmActivationInitDiagnostics(): void {
  lastInitDiagnostics = null;
}

/** Round a millisecond value to an integer, or `?` when not measured. */
function ms(value: number | undefined): string {
  return value === undefined ? "?" : String(Math.round(value));
}

/** Byte count field, or `?` for the not-observed sentinel (negative). */
function bytesField(byteLength: number | undefined): string {
  return byteLength === undefined || byteLength < 0 ? "?" : String(byteLength);
}

/** Single-line, greppable rendering of the captured worker `error` event. */
function workerErrorField(workerError?: Error): string {
  if (!workerError) return "none";
  // JSON.stringify keeps the value on one line and quotes embedded spaces.
  return JSON.stringify(workerError.message);
}

/** The `cache=…`/`cacheDir=…`/`bundleBytes=…` fields for a bundle phase. */
function bundleFields(wasm: WasmActivationInitDiagnostics | null): string {
  const cache = wasm ? wasm.bundle.outcome : "unknown";
  const cacheDir = wasm ? (wasm.bundle.cacheDir ?? "none") : "none";
  const bundleBytes = wasm ? bytesField(wasm.bundle.byteLength) : "?";
  return `cache=${cache} cacheDir=${cacheDir} bundleBytes=${bundleBytes} ` +
    `bundleLoadMs=${ms(wasm?.bundle.elapsedMs)} ` +
    `glueImportMs=${ms(wasm?.glueImportMs)} ` +
    `instantiateMs=${ms(wasm?.instantiateMs)} ` +
    `wasmTotalMs=${ms(wasm?.totalMs)}`;
}

/** Inputs to {@link formatWorkerInitDiagnostics}. */
export interface WorkerInitLineInput {
  /** Stable label identifying the worker slot (e.g. `worker-3`). */
  workerLabel: string;
  /** Parent-observed handshake time (init request → response), in ms. */
  handshakeMs: number;
  /** Recorded main-thread WASM phase timings, or `null` when unmeasured. */
  wasm: WasmActivationInitDiagnostics | null;
  /** Any worker `error`/`messageerror` captured during init. */
  workerError?: Error;
}

/**
 * Format the always-on, `info`-level line emitted once per successful worker
 * init. Shape is the greppable contract documented on this module.
 */
export function formatWorkerInitDiagnostics(
  input: WorkerInitLineInput,
): string {
  const { workerLabel, handshakeMs, wasm, workerError } = input;
  return `${WASM_WORKER_INIT_LOG_PREFIX} worker=${workerLabel} outcome=ok ` +
    `handshakeMs=${ms(handshakeMs)} ${bundleFields(wasm)} ` +
    `workerError=${workerErrorField(workerError)}`;
}

/** Inputs to {@link formatWorkerInitTimeout}. */
export interface WorkerInitTimeoutInput {
  /** Stable label identifying the worker slot (e.g. `worker-3`). */
  workerLabel: string;
  /** The configured init timeout, in ms. */
  timeoutMs: number;
  /** Parent-observed elapsed time from init start to the timeout, in ms. */
  elapsedMs: number;
  /** Recorded main-thread WASM phase timings, or `null` when unmeasured. */
  wasm: WasmActivationInitDiagnostics | null;
  /** Any worker `error`/`messageerror` captured during init. */
  workerError?: Error;
  /**
   * Milliseconds into the handshake at which the child's start heartbeat
   * arrived, or `undefined` when it never did (Issue #3771).
   */
  heartbeatMs?: number;
}

/**
 * The `heartbeat=…` field and the sentence that reads it (Issue #3771).
 *
 * A received heartbeat proves the child isolate started and evaluated its
 * entry point, so a subsequent stall is inside the worker (CPU starvation or a
 * stuck init) rather than a spawn that never happened. No heartbeat means the
 * isolate never got that far — spawn starvation or OOM.
 */
function heartbeatFields(
  heartbeatMs: number | undefined,
): { field: string; verdict: string } {
  if (heartbeatMs === undefined) {
    return {
      field: "heartbeat=none",
      verdict: "The child never sent its start heartbeat, so it did not " +
        "reach its entry point — suspect spawn starvation or OOM, not WASM " +
        "loading.",
    };
  }
  return {
    field: `heartbeat=received heartbeatMs=${ms(heartbeatMs)}`,
    verdict: "The child sent its start heartbeat and then stalled before " +
      "answering — suspect CPU starvation or a stuck init, not a failed spawn.",
  };
}

/**
 * Build the timeout error message. The breakdown is embedded here (not merely
 * logged) so it survives into the caller's `Error:`-suffixed fallback log line
 * and GRQ's `firstError=` field. Child-side phase timings are still unknown —
 * a worker that never answered cannot report them — but the start heartbeat
 * (Issue #3771) says whether the child ever ran, which is what separates the
 * "never started" and "started and stalled" cases the phase timings cannot.
 */
export function formatWorkerInitTimeout(
  input: WorkerInitTimeoutInput,
): string {
  const { workerLabel, timeoutMs, elapsedMs, wasm, workerError, heartbeatMs } =
    input;
  const seconds = Math.round(timeoutMs / 1000);
  const parentWasm = wasm
    ? `wasm[${bundleFields(wasm)}]`
    : "wasm[not-measured]";
  const heartbeat = heartbeatFields(heartbeatMs);
  return `${WASM_WORKER_INIT_LOG_PREFIX} Worker init: no response after ` +
    `${seconds}s (worker=${workerLabel}). Parent-observed: ` +
    `handshakeMs=${ms(elapsedMs)} workerError=${
      workerErrorField(workerError)
    } ` +
    `${heartbeat.field} ` +
    `${parentWasm}. Child WASM phase timings unknown — the worker never ` +
    `answered the init handshake (may be stuck loading WASM, CPU-starved, ` +
    `or OOM). ${heartbeat.verdict}`;
}
