/**
 * V8 heap limit reader, shared by `MemoryMonitor.ts` and the event-loop
 * watchdog (`EventLoopWatchdog.ts`, Issue #4096).
 *
 * @module
 */

import v8 from "node:v8";

/**
 * The current isolate's V8 old-space heap limit in bytes (Issue #3410).
 *
 * Returns `0` when `node:v8` cannot report the limit, so `resolveHeapLimit`
 * transparently falls back to the committed `heapTotal` rather than dividing by
 * a bogus value. The event-loop watchdog likewise reports a `0` limit as
 * `unknown` in its breach line (Issue #4096).
 */
export function readHeapSizeLimit(): number {
  try {
    const limit = v8.getHeapStatistics().heap_size_limit;
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
  } catch {
    return 0;
  }
}
