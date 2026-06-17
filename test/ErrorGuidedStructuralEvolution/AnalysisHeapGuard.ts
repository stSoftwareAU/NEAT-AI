/**
 * Tests for the analysis-extension heap guard (Issue #2594).
 */
import { assert, assertEquals } from "@std/assert";
import {
  _setHeapGuardProviderForTests,
  checkAnalysisHeapAbort,
  type HeapGuardSample,
  isHeapCritical,
  sampleHeapPressure,
  shouldAbortOnHeapPressure,
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

// --- Issue #3025: off-heap (RSS/native budget) awareness ------------------

const MB = 1024 * 1024;

/** Configured RSS budget with headroom above the GRQ-23 sample's RSS. */
const NATIVE_BUDGET = Math.round(16384 * MB);

/** GRQ-23: V8 heap ≈86% (CRITICAL) but native RSS well within budget. */
const GRQ23_SAMPLE = {
  heapUsed: Math.round(231 * MB),
  heapTotal: Math.round(269 * MB),
  rss: Math.round(13289 * MB),
  external: Math.round(47 * MB),
};

function criticalSample(rss: number): HeapGuardSample {
  return {
    usageFraction: 0.86,
    pressureLevel: "critical",
    heapUsed: Math.round(231 * MB),
    heapTotal: Math.round(269 * MB),
    rss,
    external: Math.round(47 * MB),
  };
}

Deno.test("sampleHeapPressure: captures rss and external from the provider (#3025)", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({
      heapUsed: 95,
      heapTotal: 100,
      rss: 12345,
      external: 678,
    }),
  );
  assertEquals(sample.rss, 12345);
  assertEquals(sample.external, 678);
});

Deno.test("sampleHeapPressure: rss/external default to 0 when unreported (#3025)", () => {
  const sample = sampleHeapPressure(
    DEFAULT_MEMORY_CONFIG,
    fixedProvider({ heapUsed: 95, heapTotal: 100 }),
  );
  assertEquals(sample.rss, 0);
  assertEquals(sample.external, 0);
});

Deno.test("shouldAbortOnHeapPressure: V8-only CRITICAL within native budget does NOT abort (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  assertEquals(
    shouldAbortOnHeapPressure(criticalSample(GRQ23_SAMPLE.rss), config),
    false,
  );
});

Deno.test("shouldAbortOnHeapPressure: RSS over native budget still aborts (genuine OOM) (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  assertEquals(
    shouldAbortOnHeapPressure(criticalSample(NATIVE_BUDGET + MB), config),
    true,
  );
});

Deno.test("shouldAbortOnHeapPressure: no native budget configured keeps legacy V8-only abort (#3025)", () => {
  // DEFAULT_MEMORY_CONFIG has nativeBudgetBytes = 0.
  assertEquals(
    shouldAbortOnHeapPressure(
      criticalSample(GRQ23_SAMPLE.rss),
      DEFAULT_MEMORY_CONFIG,
    ),
    true,
  );
});

Deno.test("shouldAbortOnHeapPressure: budget configured but RSS unreported falls back to abort (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  assertEquals(shouldAbortOnHeapPressure(criticalSample(0), config), true);
});

Deno.test("shouldAbortOnHeapPressure: non-critical never aborts even with budget (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  const normal: HeapGuardSample = {
    usageFraction: 0.1,
    pressureLevel: "normal",
    heapUsed: 10,
    heapTotal: 100,
    rss: NATIVE_BUDGET + MB, // even over budget — not critical, so no abort
    external: 0,
  };
  assertEquals(shouldAbortOnHeapPressure(normal, config), false);
});

Deno.test("shouldAbortOnHeapPressure: monitoring disabled never aborts (#3025)", () => {
  const config = {
    ...DEFAULT_MEMORY_CONFIG,
    enabled: false,
    nativeBudgetBytes: NATIVE_BUDGET,
  };
  assertEquals(shouldAbortOnHeapPressure(criticalSample(0), config), false);
});

Deno.test("checkAnalysisHeapAbort: GRQ-23 V8-only CRITICAL within budget returns abort:false (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  const { logger, lines } = makeRecordingLogger();
  const result = checkAnalysisHeapAbort(
    "grq23-disc",
    config,
    logger,
    fixedProvider(GRQ23_SAMPLE),
  );
  assertEquals(result.abort, false);
  assertEquals(result.sample.pressureLevel, "critical");
  assertEquals(result.sample.rss, GRQ23_SAMPLE.rss);
  assertEquals(
    lines.length,
    0,
    "no abort log when off-heap budget has headroom",
  );
});

Deno.test("checkAnalysisHeapAbort: RSS over budget still aborts and logs (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  const { logger, lines } = makeRecordingLogger();
  const result = checkAnalysisHeapAbort(
    "grq23-oom",
    config,
    logger,
    fixedProvider({ ...GRQ23_SAMPLE, rss: NATIVE_BUDGET + MB }),
  );
  assertEquals(result.abort, true);
  assertEquals(lines.filter((l) => l.level === "warn").length, 1);
});

Deno.test("isHeapCritical: V8-only CRITICAL within budget returns false (#3025)", () => {
  const config = { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
  assertEquals(isHeapCritical(config, fixedProvider(GRQ23_SAMPLE)), false);
  assertEquals(
    isHeapCritical(
      config,
      fixedProvider({ ...GRQ23_SAMPLE, rss: NATIVE_BUDGET + MB }),
    ),
    true,
  );
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
