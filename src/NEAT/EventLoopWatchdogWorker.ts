/// <reference lib="deno.worker" />

/**
 * Worker half of the event-loop watchdog — Issue #4066, part of #4060.
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
  generationBuffer: SharedArrayBuffer;
}

/** Write every byte of `bytes` to stderr. `writeSync` may write partially. */
function writeAllStderr(bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += Deno.stderr.writeSync(bytes.subarray(offset));
  }
}

self.onmessage = (event: MessageEvent<ArmMessage>) => {
  // Only the first message arms the watchdog. Any later message is ignored.
  self.onmessage = null;

  const { deadlineEpochMS, breachLine, generationBuffer } = event.data;
  const generation = new Int32Array(generationBuffer);
  const encoder = new TextEncoder();

  const breach = (): void => {
    const value = Atomics.load(generation, 0);
    const label = value < 0 ? "unknown" : String(value);
    const line = breachLine.replaceAll("{generation}", label) + "\n";
    writeAllStderr(encoder.encode(line));
    try {
      Deno.kill(Deno.pid, "SIGTERM");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeAllStderr(
        encoder.encode(
          `[Neat] event-loop watchdog could not kill the process: ${message}\n`,
        ),
      );
      throw err;
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
