/**
 * Tests for the analysis-extension heap guard (Issue #2594).
 */
import { assert, assertEquals } from "@std/assert";
import {
  _setHeapGuardProviderForTests,
  checkAnalysisHeapAbort,
  isHeapCritical,
  sampleHeapPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";

function makeRecordingLogger() {
  const lines: { level: string; message: string }[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push({ level: "debug", message: args.join(" ") }),
    info: (...args) => lines.push({ level: "info", message: args.join(" ") }),
    warn: (...args) => lines.push({ level: "warn", message: args.join(" ") }),
    error: (...args) => lines.push({ level: "error", message: args.join(" ") }),
  };
  return { logger, lines };
}

function fixedProvider(sample: MemoryUsageSample): () => MemoryUsageSample {
  return () => sample;
}

Deno.test("sampleHeapPressure: critical when ratio above default threshold", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({ heapUsed: 95, heapTotal: 100 }),
  );
  assertEquals(sample.pressureLevel, "critical");
  assertEquals(sample.usageFraction, 0.95);
});

Deno.test("sampleHeapPressure: warning between warning and critical", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({ heapUsed: 75, heapTotal: 100 }),
  );
  assertEquals(sample.pressureLevel, "warning");
});

Deno.test("sampleHeapPressure: normal below warning threshold", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({ heapUsed: 50, heapTotal: 100 }),
  );
  assertEquals(sample.pressureLevel, "normal");
});

Deno.test("sampleHeapPressure: heapTotal=0 reports normal (no telemetry)", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({ heapUsed: 0, heapTotal: 0 }),
  );
  assertEquals(sample.pressureLevel, "normal");
  assertEquals(sample.usageFraction, 0);
});

Deno.test("isHeapCritical: returns true when heap at critical", () => {
  assertEquals(
    isHeapCritical(
      DEFAULT_MEMORY_CONFIG,
      fixedProvider({ heapUsed: 90, heapTotal: 100 }),
    ),
    true,
  );
});

Deno.test("isHeapCritical: false when monitoring disabled even if heap critical", () => {
  const disabled = { ...DEFAULT_MEMORY_CONFIG, enabled: false };
  assertEquals(
    isHeapCritical(
      disabled,
      fixedProvider({ heapUsed: 99, heapTotal: 100 }),
    ),
    false,
  );
});

Deno.test("isHeapCritical: respects custom criticalThreshold", () => {
  const tight = { ...DEFAULT_MEMORY_CONFIG, criticalThreshold: 0.5 };
  assertEquals(
    isHeapCritical(tight, fixedProvider({ heapUsed: 60, heapTotal: 100 })),
    true,
  );
  assertEquals(
    isHeapCritical(tight, fixedProvider({ heapUsed: 40, heapTotal: 100 })),
    false,
  );
});

Deno.test("checkAnalysisHeapAbort: aborts and logs once when critical", () => {
  const { logger, lines } = makeRecordingLogger();
  const result = checkAnalysisHeapAbort(
    "abc12345",
    DEFAULT_MEMORY_CONFIG,
    logger,
    fixedProvider({ heapUsed: 92, heapTotal: 100 }),
  );
  assertEquals(result.abort, true);
  assertEquals(result.sample.pressureLevel, "critical");

  const warnLines = lines.filter((l) => l.level === "warn");
  assertEquals(warnLines.length, 1, "abort log line emitted exactly once");
  assert(
    warnLines[0].message.includes(
      "[Neat] Discovery abc12345 analysis aborted: heap CRITICAL at extension boundary",
    ),
    `unexpected log line: ${warnLines[0].message}`,
  );
});

Deno.test("checkAnalysisHeapAbort: no abort and no log when normal", () => {
  const { logger, lines } = makeRecordingLogger();
  const result = checkAnalysisHeapAbort(
    "abc12345",
    DEFAULT_MEMORY_CONFIG,
    logger,
    fixedProvider({ heapUsed: 30, heapTotal: 100 }),
  );
  assertEquals(result.abort, false);
  assertEquals(result.sample.pressureLevel, "normal");
  assertEquals(lines.length, 0, "no log lines emitted on normal heap");
});

Deno.test("checkAnalysisHeapAbort: no abort when monitoring disabled even if critical", () => {
  const { logger, lines } = makeRecordingLogger();
  const disabled = { ...DEFAULT_MEMORY_CONFIG, enabled: false };
  const result = checkAnalysisHeapAbort(
    "abc12345",
    disabled,
    logger,
    fixedProvider({ heapUsed: 99, heapTotal: 100 }),
  );
  assertEquals(result.abort, false);
  assertEquals(lines.length, 0);
});

Deno.test("_setHeapGuardProviderForTests: module-level override is honoured", () => {
  try {
    _setHeapGuardProviderForTests(() => ({ heapUsed: 91, heapTotal: 100 }));
    assertEquals(isHeapCritical(DEFAULT_MEMORY_CONFIG), true);

    _setHeapGuardProviderForTests(() => ({ heapUsed: 10, heapTotal: 100 }));
    assertEquals(isHeapCritical(DEFAULT_MEMORY_CONFIG), false);
  } finally {
    _setHeapGuardProviderForTests(undefined);
  }
});
