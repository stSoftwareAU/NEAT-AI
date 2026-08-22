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
 *      Parent-observed: handshakeMs=60000 parentStallMs=835250 loopBlockedMs=0 \
 *      spawnToInitMs=12 workerError=none heartbeat=none \
 *      wasm[cache=hit …]. Child WASM phase timings unknown — the worker never \
 *      answered … The child never sent its start heartbeat …
 *    ```
 *
 *    `heartbeat=received heartbeatMs=N` / `heartbeat=none` (Issue #3771) is
 *    the field that separates a child which started and then stalled from one
 *    that never started at all.
 *
 * ## Whose time is it? (GRQ #4238)
 *
 * A GRQ-13 run reported `handshakeMs=895250` — 14m 55s — against a 60s
 * deadline, because the counter was a raw elapsed-time read taken inside the
 * timeout callback: when the parent's own event loop is blocked the timer fires
 * late and the overshoot is billed to the child. The handshake window is now
 * split into three independently measured fields, so no field can absorb
 * another's time:
 *
 * - `handshakeMs` — what the parent actually observed, capped at the deadline
 *   ({@link splitHandshakeObservation}). It can never exceed `timeoutMs`.
 * - `parentStallMs` — how far past the deadline the timeout callback fired.
 *   Parent-side by construction: the child cannot delay the parent's own timer.
 * - `loopBlockedMs` — the longest event-loop block *sampled inside* the
 *   handshake window by the parent's watchdog. A parent that stalls and
 *   recovers before the deadline shows up here and nowhere else.
 *
 * That matters for the verdict as much as for the numbers: while the parent is
 * blocked it cannot receive the child's start heartbeat either, so
 * `heartbeat=none` is only evidence about the child when the parent stayed
 * responsive. See {@link PARENT_STALL_TOLERANCE_MS}.
 *
 * The phrase "no response after Ns" is preserved so existing operator greps
 * keep matching, as is "stuck loading WASM" — now only in the case where the
 * parent was blind and the candidates genuinely cannot be separated.
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

/**
 * Overshoot below this is ordinary timer/interval scheduling jitter, not a
 * stalled parent (GRQ #4238). Above it, the parent demonstrably stopped
 * servicing its own event loop, so parent-observed *absences* — no response,
 * no heartbeat — stop being evidence about the child.
 */
export const PARENT_STALL_TOLERANCE_MS = 250;

/** Inputs to {@link formatWorkerInitTimeout}. */
export interface WorkerInitTimeoutInput {
  /** Stable label identifying the worker slot (e.g. `worker-3`). */
  workerLabel: string;
  /** The configured init timeout, in ms. */
  timeoutMs: number;
  /**
   * Parent-observed elapsed time from the init request to the moment the
   * timeout callback ran, in ms. This is raw: it includes any time the
   * parent's event loop was blocked past the deadline, which
   * {@link splitHandshakeObservation} separates out rather than reporting as
   * handshake time (GRQ #4238).
   */
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
  /**
   * Longest event-loop block sampled by the parent's watchdog *inside* the
   * handshake window, in ms (GRQ #4238). `undefined` when no watchdog ran.
   */
  loopBlockedMs?: number;
  /**
   * Milliseconds between the worker being spawned and the init request being
   * posted (GRQ #4238). Reported separately so parent-side pre-handshake work
   * can never be mistaken for handshake time. `undefined` when the spawn
   * instant was not observed.
   */
  spawnToInitMs?: number;
}

/** The three independently-measured parts of a timed-out handshake window. */
export interface HandshakeObservation {
  /** What the parent actually observed, never above the deadline. */
  handshakeMs: number;
  /** How far past the deadline the timeout callback fired (parent-side). */
  parentStallMs: number;
  /** True when the parent stall is beyond ordinary scheduling jitter. */
  parentStalled: boolean;
}

/**
 * Split a raw elapsed-time reading into the handshake the parent observed and
 * the parent-side overshoot (GRQ #4238).
 *
 * The parent stops observing at its own deadline: it declared the handshake
 * failed at `timeoutMs`, so that is the longest handshake it can honestly
 * report. Anything beyond is time the parent's event loop failed to run the
 * timer — the child cannot delay the parent's own timer, so the overshoot is
 * parent-side by construction.
 *
 * @param elapsedMs - raw elapsed ms read inside the timeout callback.
 * @param timeoutMs - the configured deadline.
 * @param loopBlockedMs - longest block sampled inside the window, if measured.
 */
export function splitHandshakeObservation(
  elapsedMs: number,
  timeoutMs: number,
  loopBlockedMs?: number,
): HandshakeObservation {
  const observed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const deadline = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const handshakeMs = Math.min(observed, deadline);
  const parentStallMs = observed - handshakeMs;
  const blocked = Number.isFinite(loopBlockedMs ?? Number.NaN)
    ? Math.max(0, loopBlockedMs as number)
    : 0;
  return {
    handshakeMs,
    parentStallMs,
    // Either symptom is enough: a late timer, or a block that recovered
    // before the deadline and so never showed up as overshoot.
    parentStalled: parentStallMs > PARENT_STALL_TOLERANCE_MS ||
      blocked > PARENT_STALL_TOLERANCE_MS,
  };
}

/** The `heartbeat=…` field for the timeout line (Issue #3771). */
function heartbeatField(heartbeatMs: number | undefined): string {
  return heartbeatMs === undefined
    ? "heartbeat=none"
    : `heartbeat=received heartbeatMs=${ms(heartbeatMs)}`;
}

/**
 * The verdict sentence, derived from the signals actually measured rather
 * than from a fixed list of candidates (Issue #3771, GRQ #4238).
 *
 * - A *received* heartbeat is positive evidence in every case: the isolate
 *   started and evaluated its entry point, so the stall is inside the child.
 * - A *missing* heartbeat only means something when the parent stayed
 *   responsive. A blocked parent cannot receive a heartbeat, so reading its
 *   absence as "the child never started" attributes the parent's own stall to
 *   the child — the misdiagnosis GRQ #4238 was raised for.
 */
function initVerdict(
  heartbeatMs: number | undefined,
  observation: HandshakeObservation,
  loopBlockedMs: number | undefined,
  seconds: number,
): string {
  const stall = observation.parentStalled
    ? `The parent's own event loop stalled during the handshake ` +
      `(parentStallMs=${ms(observation.parentStallMs)} ` +
      `loopBlockedMs=${
        ms(loopBlockedMs)
      } against a ${seconds}s deadline), so ` +
      `handshakeMs is capped at the deadline and the overshoot is parent-side ` +
      `time, not child time. `
    : "";

  if (heartbeatMs !== undefined) {
    return stall +
      "The child sent its start heartbeat and then stalled before " +
      "answering — suspect CPU starvation or a stuck init, not a failed spawn.";
  }
  if (observation.parentStalled) {
    return stall +
      "A blocked parent cannot receive a heartbeat either, so the missing " +
      "heartbeat is not evidence about the child: whether it was stuck " +
      "loading WASM, CPU-starved or OOM cannot be separated from this line — " +
      "fix the parent-side stall first.";
  }
  return "The parent stayed responsive throughout, so the missing heartbeat " +
    "is a real signal: the child never sent it, did not reach its entry " +
    "point, and therefore never began loading WASM — suspect spawn " +
    "starvation or OOM.";
}

/**
 * Build the timeout error message. The breakdown is embedded here (not merely
 * logged) so it survives into the caller's `Error:`-suffixed fallback log line
 * and GRQ's `firstError=` field. Child-side phase timings are still unknown —
 * a worker that never answered cannot report them — but the start heartbeat
 * (Issue #3771) says whether the child ever ran, and the parent's own stall
 * measurements (GRQ #4238) say whether that heartbeat could have been heard.
 */
export function formatWorkerInitTimeout(
  input: WorkerInitTimeoutInput,
): string {
  const {
    workerLabel,
    timeoutMs,
    elapsedMs,
    wasm,
    workerError,
    heartbeatMs,
    loopBlockedMs,
    spawnToInitMs,
  } = input;
  const seconds = Math.round(timeoutMs / 1000);
  const parentWasm = wasm
    ? `wasm[${bundleFields(wasm)}]`
    : "wasm[not-measured]";
  const observation = splitHandshakeObservation(
    elapsedMs,
    timeoutMs,
    loopBlockedMs,
  );
  return `${WASM_WORKER_INIT_LOG_PREFIX} Worker init: no response after ` +
    `${seconds}s (worker=${workerLabel}). Parent-observed: ` +
    `handshakeMs=${ms(observation.handshakeMs)} ` +
    `parentStallMs=${ms(observation.parentStallMs)} ` +
    `loopBlockedMs=${ms(loopBlockedMs)} ` +
    `spawnToInitMs=${ms(spawnToInitMs)} ` +
    `workerError=${workerErrorField(workerError)} ` +
    `${heartbeatField(heartbeatMs)} ` +
    `${parentWasm}. Child WASM phase timings unknown — the worker never ` +
    `answered the init handshake. ` +
    initVerdict(heartbeatMs, observation, loopBlockedMs, seconds);
}
