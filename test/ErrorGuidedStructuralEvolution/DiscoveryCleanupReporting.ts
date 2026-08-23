/**
 * `cleanup complete` must only be logged when cleanup actually completed
 * (GRQ #4241).
 *
 * The source log showed `Failed to cleanup discovery temp dir: ... Directory
 * not empty (os error 66)` immediately followed by `Discovery <id> cleanup
 * complete.` — anyone reconciling the log (or the absence of an error marker)
 * recorded a clean cleanup that never happened. These tests drive
 * `DataRecorder.runCleanup` directly and assert on what it logs.
 */

import { assert, assertEquals } from "@std/assert";
import { DataRecorder } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorder.ts";
import { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import type { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

function captureLogs(): { logs: CapturedLog[]; restore: () => void } {
  const logs: CapturedLog[] = [];
  const original = getLogger();
  const capturing: Logger = {
    debug: (...args: unknown[]) =>
      logs.push({ level: "debug", message: args.map(String).join(" ") }),
    info: (...args: unknown[]) =>
      logs.push({ level: "info", message: args.map(String).join(" ") }),
    warn: (...args: unknown[]) =>
      logs.push({ level: "warn", message: args.map(String).join(" ") }),
    error: (...args: unknown[]) =>
      logs.push({ level: "error", message: args.map(String).join(" ") }),
  };
  setLogger(capturing);
  return { logs, restore: () => setLogger(original) };
}

type RunCleanup = (
  discoverStructure: DiscoverStructure,
  perfStats: DiscoveryPerformanceStats,
  startTime: number,
) => Promise<void>;

/**
 * Invokes the private `runCleanup` with the minimal state it reads: the
 * discovery ID, a verbose config, and the await-cleanup decision GRQ uses in
 * production (`NEAT_DISCOVERY_AWAIT_CLEANUP=true`).
 */
async function runCleanup(
  cleanUp: () => Promise<void>,
  perfStats: DiscoveryPerformanceStats,
): Promise<void> {
  const proto = DataRecorder.prototype as unknown as { runCleanup: RunCleanup };
  const self = {
    ID: "e16b116e",
    config: { verbose: true, log: 0 },
    shouldAwaitCleanup: () => true,
  };
  const discoverStructure = { cleanUp } as unknown as DiscoverStructure;
  await proto.runCleanup.call(
    self as unknown as DataRecorder,
    discoverStructure,
    perfStats,
    Date.now(),
  );
}

Deno.test("runCleanup does not report completion when cleanup failed", async () => {
  const capture = captureLogs();
  const perfStats = new DiscoveryPerformanceStats();
  try {
    await runCleanup(
      () =>
        Promise.reject(
          new Error(
            "Discovery temp dir cleanup failed: '.discovery/e16b116e' still exists",
          ),
        ),
      perfStats,
    );

    const completed = capture.logs.filter((l) =>
      l.message.includes("cleanup complete") ||
      l.message.includes("cleanup awaited and complete")
    );
    assertEquals(
      completed.length,
      0,
      `A failed cleanup must not be reported as complete: ${
        JSON.stringify(completed)
      }`,
    );

    const failures = capture.logs.filter((l) =>
      l.level === "error" && l.message.includes("cleanup failed")
    );
    assert(
      failures.length > 0,
      `Expected a loud cleanup-failure line, got ${
        JSON.stringify(capture.logs)
      }`,
    );
  } finally {
    capture.restore();
  }
});

Deno.test("runCleanup reports completion when cleanup succeeded", async () => {
  const capture = captureLogs();
  const perfStats = new DiscoveryPerformanceStats();
  try {
    await runCleanup(() => Promise.resolve(), perfStats);

    const completed = capture.logs.filter((l) =>
      l.message.includes("cleanup complete")
    );
    assert(
      completed.length > 0,
      `Expected a completion line, got ${JSON.stringify(capture.logs)}`,
    );
    assertEquals(
      capture.logs.filter((l) => l.level === "error").length,
      0,
    );
  } finally {
    capture.restore();
  }
});
