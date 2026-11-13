/// <reference lib="deno.worker" />

/**
 * Worker half of the event-loop watchdog — Issue #4066, part of #4060; liveness
 * measurement — Issue #4096.
 *
 * This module runs inside the Worker that `armEventLoopWatchdog`
 * (`EventLoopWatchdog.ts`) spawns. It owns the deadline timer, so the deadline
 * still fires when the main thread is blocked in a synchronous loop or when
 * V8 is thrashing in garbage collection.
 *
 * On breach it writes the breach line to stderr, then sends `SIGKILL` to the
 * whole process. `SIGKILL` is used because `SIGTERM` is swallowed by the
 * main-thread listeners, and `Deno.exit` from a Worker ends only the Worker.
 *
 * The breach line carries the measured liveness of the main thread:
 *
 * - `lastHeartbeatAgeMs` is the age of the newest heartbeat the main thread
 *   bumped. The heartbeat is set at arm and then every `heartbeatIntervalMS`,
 *   so the age is roughly the time since arm or since the last tick. An age far
 *   above `heartbeatIntervalMS` means the main loop was blocked: it never got
 *   to tick. An age at or below about one interval means the loop was alive
 *   and the run was simply over budget.
 * - `inFlightPhase` is the phase the run last declared with `setPhase`.
 * - `heartbeatIntervalMS` is the interval the heartbeat is measured against.
 * - `lastHeartbeatHeapUsedMB` is the V8 heap used, in MiB, when the main thread
 *   last ticked.
 * - `heapLimitMB` is the isolate's V8 heap limit (`heap_size_limit`), in MiB.
 *   A blocked loop whose last heap reading is close to the limit points at
 *   garbage collection near the heap limit; a blocked loop with plenty of
 *   headroom points at synchronous main-thread work. Either reads `unknown`
 *   when it was not measured.
 *
 * This file must import nothing. It runs as a standalone module, and it is
 * loaded by URL from the main thread.
 *
 * @module
 */

/**
 * How often the Worker re-checks the real wall clock while the deadline is
 * still ahead. A far deadline never overflows `setTimeout`'s 2^31-1 ms limit,
 * and a wall-clock jump is noticed within one interval.
 */
const POLL_MS = 1_000;

interface ArmMessage {
  deadlineEpochMS: number;
  breachLine: string;
  /** Slot 0 is the generation; slot 1 is the phase index. */
  generationBuffer: SharedArrayBuffer;
  /** One 64-bit slot of epoch milliseconds, bumped by the main thread. */
  heartbeatBuffer: SharedArrayBuffer;
  /**
   * Two 64-bit slots: heap used at the latest heartbeat, then the V8 heap
   * limit, both in bytes; 0 means not measured.
   */
  heapBuffer: SharedArrayBuffer;
  /** Phase names, indexed by the phase slot. */
  phaseNames: readonly string[];
  /** The interval the heartbeat is measured against, echoed in the breach line. */
  heartbeatIntervalMS: number;
}

const encoder = new TextEncoder();

/** Write every byte of `bytes` to stderr. `writeSync` may write partially. */
function writeAllStderr(bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += Deno.stderr.writeSync(bytes.subarray(offset));
  }
}

/**
 * Send SIGKILL to the whole process. If the signal cannot be sent, say so on
 * stderr and rethrow, so a watchdog that fails to kill fails loudly.
 */
function killProcess(): void {
  try {
    Deno.kill(Deno.pid, "SIGKILL");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeAllStderr(
      encoder.encode(
        `[Neat] event-loop watchdog could not kill the process: ${message}\n`,
      ),
    );
    throw err;
  }
}

self.onmessage = (event: MessageEvent<ArmMessage>) => {
  // Only the first message arms the watchdog. Any later message is ignored.
  self.onmessage = null;

  const {
    deadlineEpochMS,
    breachLine,
    generationBuffer,
    heartbeatBuffer,
    heapBuffer,
    phaseNames,
    heartbeatIntervalMS,
  } = event.data;
  const generation = new Int32Array(generationBuffer);
  const heartbeat = new BigInt64Array(heartbeatBuffer);
  const heap = new BigInt64Array(heapBuffer);

  /** Bytes in a slot as whole MiB, or `unknown` when not measured. */
  const heapMB = (slot: number): string => {
    const bytes = Atomics.load(heap, slot);
    return bytes <= 0n
      ? "unknown"
      : String(Math.round(Number(bytes) / (1024 * 1024)));
  };

  /** The breach line, with the measured liveness suffix. */
  const breachText = (): string => {
    const value = Atomics.load(generation, 0);
    const label = value < 0 ? "unknown" : String(value);
    const line = breachLine.replaceAll("{generation}", label);
    const ageMs = Math.max(0, Date.now() - Number(Atomics.load(heartbeat, 0)));
    const phase = phaseNames[Atomics.load(generation, 1)];
    return `${line} lastHeartbeatAgeMs=${ageMs} inFlightPhase=${phase} heartbeatIntervalMS=${heartbeatIntervalMS} lastHeartbeatHeapUsedMB=${
      heapMB(0)
    } heapLimitMB=${heapMB(1)}\n`;
  };

  const breach = (): void => {
    // The kill runs even if building or writing the breach line throws. An
    // unwritten breach line must never leave the process alive past its
    // deadline.
    try {
      writeAllStderr(encoder.encode(breachText()));
    } finally {
      killProcess();
    }
  };

  const check = (): void => {
    const remaining = deadlineEpochMS - Date.now();
    if (remaining <= 0) {
      breach();
      return;
    }
    setTimeout(check, Math.min(remaining, POLL_MS));
  };

  check();
};
