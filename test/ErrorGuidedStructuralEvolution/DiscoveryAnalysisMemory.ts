/**
 * Tests for the Discovery analysis-memory FFI wiring (Issue #3432).
 *
 * All FFI access goes through injectable dependencies, so these tests run
 * without a built NEAT-AI-Discovery library and without a GPU.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type DiscoveryAnalysisMemoryDeps,
  formatDiscoveryMemoryUsage,
  resolveAnalysisMemoryBudgetMb,
  shouldCancelAnalysisForMemoryPressure,
  signalDiscoveryMemoryPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryAnalysisMemory.ts";
import type { HeapGuardSample } from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import {
  DEFAULT_MEMORY_CONFIG,
  type RequiredMemoryConfig,
} from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";

const MB = 1024 * 1024;

function makeRecordingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push(args.join(" ")),
    info: (...args) => lines.push(args.join(" ")),
    warn: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
  };
  return { logger, lines };
}

/** Records every call so tests can assert the FFI was (or was not) reached. */
function makeSpyDeps(options: {
  usageBytes?: number | undefined;
  cancelSucceeds?: boolean;
} = {}): DiscoveryAnalysisMemoryDeps & {
  usageCalls: number;
  cancelCalls: number;
} {
  const spy = {
    usageCalls: 0,
    cancelCalls: 0,
    usageBytes: () => {
      spy.usageCalls++;
      return options.usageBytes;
    },
    cancelMemoryPressure: () => {
      spy.cancelCalls++;
      return options.cancelSucceeds ?? true;
    },
  };
  return spy;
}

function sample(overrides: Partial<HeapGuardSample> = {}): HeapGuardSample {
  return {
    usageFraction: 0.5,
    pressureLevel: "normal",
    heapUsed: 50 * MB,
    heapTotal: 100 * MB,
    heapLimit: 100 * MB,
    rss: 100 * MB,
    external: 0,
    ...overrides,
  };
}

function config(
  overrides: Partial<RequiredMemoryConfig> = {},
): RequiredMemoryConfig {
  return { ...DEFAULT_MEMORY_CONFIG, ...overrides };
}

function fixedProvider(s: MemoryUsageSample): () => MemoryUsageSample {
  return () => s;
}

// ── resolveAnalysisMemoryBudgetMb ────────────────────────────────────────

Deno.test("resolveAnalysisMemoryBudgetMb: unconfigured budget is omitted", () => {
  assertEquals(resolveAnalysisMemoryBudgetMb(DEFAULT_MEMORY_CONFIG), undefined);
});

Deno.test("resolveAnalysisMemoryBudgetMb: zero and negatives are omitted", () => {
  assertEquals(
    resolveAnalysisMemoryBudgetMb({ maxAnalysisMemoryMb: 0 }),
    undefined,
  );
  assertEquals(
    resolveAnalysisMemoryBudgetMb({ maxAnalysisMemoryMb: -512 }),
    undefined,
  );
});

Deno.test("resolveAnalysisMemoryBudgetMb: non-finite budget is omitted", () => {
  assertEquals(
    resolveAnalysisMemoryBudgetMb({ maxAnalysisMemoryMb: Number.NaN }),
    undefined,
  );
  assertEquals(
    resolveAnalysisMemoryBudgetMb({
      maxAnalysisMemoryMb: Number.POSITIVE_INFINITY,
    }),
    undefined,
  );
});

Deno.test("resolveAnalysisMemoryBudgetMb: positive budget is floored", () => {
  assertEquals(
    resolveAnalysisMemoryBudgetMb({ maxAnalysisMemoryMb: 2048.9 }),
    2048,
  );
});

// ── shouldCancelAnalysisForMemoryPressure ────────────────────────────────

Deno.test("shouldCancelAnalysisForMemoryPressure: never cancels when monitoring disabled", () => {
  assertEquals(
    shouldCancelAnalysisForMemoryPressure(
      sample({ pressureLevel: "critical", rss: 100 * MB }),
      config({ enabled: false, nativeBudgetBytes: 1 * MB }),
    ),
    false,
  );
});

Deno.test("shouldCancelAnalysisForMemoryPressure: cancels on host CRITICAL without native budget", () => {
  assertEquals(
    shouldCancelAnalysisForMemoryPressure(
      sample({ pressureLevel: "critical" }),
      config(),
    ),
    true,
  );
});

Deno.test("shouldCancelAnalysisForMemoryPressure: cancels when RSS exceeds the native budget", () => {
  // V8 fraction is healthy — only the off-heap footprint is over budget, which
  // is exactly the growth the host cannot otherwise see.
  assertEquals(
    shouldCancelAnalysisForMemoryPressure(
      sample({ pressureLevel: "normal", rss: 900 * MB }),
      config({ nativeBudgetBytes: 800 * MB }),
    ),
    true,
  );
});

Deno.test("shouldCancelAnalysisForMemoryPressure: V8-only CRITICAL with off-heap headroom does not cancel", () => {
  assertEquals(
    shouldCancelAnalysisForMemoryPressure(
      sample({ pressureLevel: "critical", rss: 400 * MB }),
      config({ nativeBudgetBytes: 800 * MB }),
    ),
    false,
  );
});

Deno.test("shouldCancelAnalysisForMemoryPressure: healthy sample never cancels", () => {
  assertEquals(
    shouldCancelAnalysisForMemoryPressure(sample(), config()),
    false,
  );
});

// ── formatDiscoveryMemoryUsage ───────────────────────────────────────────

Deno.test("formatDiscoveryMemoryUsage: reports megabytes", () => {
  assertEquals(formatDiscoveryMemoryUsage(256 * MB), "discovery=256MB");
});

Deno.test("formatDiscoveryMemoryUsage: reports unavailable rather than zero", () => {
  assertEquals(formatDiscoveryMemoryUsage(undefined), "discovery=unavailable");
  assertEquals(formatDiscoveryMemoryUsage(-1), "discovery=unavailable");
  assertEquals(
    formatDiscoveryMemoryUsage(Number.NaN),
    "discovery=unavailable",
  );
});

// ── signalDiscoveryMemoryPressure ────────────────────────────────────────

Deno.test("signalDiscoveryMemoryPressure: healthy heap never touches the FFI", () => {
  const deps = makeSpyDeps();
  const { logger, lines } = makeRecordingLogger();
  const result = signalDiscoveryMemoryPressure(
    config(),
    logger,
    deps,
    fixedProvider({ heapUsed: 10 * MB, heapTotal: 100 * MB, rss: 50 * MB }),
  );
  assertEquals(result.shouldCancel, false);
  assertEquals(result.cancelled, false);
  assertEquals(deps.cancelCalls, 0);
  assertEquals(deps.usageCalls, 0);
  assertEquals(lines.length, 0);
});

Deno.test("signalDiscoveryMemoryPressure: CRITICAL heap cancels the in-flight analysis", () => {
  const deps = makeSpyDeps({ usageBytes: 512 * MB });
  const { logger, lines } = makeRecordingLogger();
  const result = signalDiscoveryMemoryPressure(
    config(),
    logger,
    deps,
    fixedProvider({ heapUsed: 95 * MB, heapTotal: 100 * MB, rss: 900 * MB }),
  );
  assertEquals(result.shouldCancel, true);
  assertEquals(result.cancelled, true);
  assertEquals(result.usageBytes, 512 * MB);
  assertEquals(deps.cancelCalls, 1);
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], "[DiscoveryMemory]");
  assertStringIncludes(lines[0], "cancelled in-flight discovery analysis");
  // Acceptance: Discovery-reported usage bytes are observable in the log.
  assertStringIncludes(lines[0], "discovery=512MB");
});

Deno.test("signalDiscoveryMemoryPressure: native-budget breach cancels even when V8 is healthy", () => {
  const deps = makeSpyDeps({ usageBytes: 3 * 1024 * MB });
  const { logger, lines } = makeRecordingLogger();
  const result = signalDiscoveryMemoryPressure(
    config({ nativeBudgetBytes: 2 * 1024 * MB }),
    logger,
    deps,
    fixedProvider({
      heapUsed: 20 * MB,
      heapTotal: 100 * MB,
      rss: 4 * 1024 * MB,
    }),
  );
  assertEquals(result.sample.pressureLevel, "normal");
  assertEquals(result.shouldCancel, true);
  assertEquals(deps.cancelCalls, 1);
  assertStringIncludes(lines[0], "discovery=3072MB");
});

Deno.test("signalDiscoveryMemoryPressure: reports loudly when the FFI cancel is unavailable", () => {
  const deps = makeSpyDeps({ cancelSucceeds: false, usageBytes: undefined });
  const { logger, lines } = makeRecordingLogger();
  const result = signalDiscoveryMemoryPressure(
    config(),
    logger,
    deps,
    fixedProvider({ heapUsed: 99 * MB, heapTotal: 100 * MB, rss: 900 * MB }),
  );
  assertEquals(result.shouldCancel, true);
  // Never report an unavailable FFI surface as a successful cancellation.
  assertEquals(result.cancelled, false);
  assertEquals(result.usageBytes, undefined);
  assert(lines.length === 1, "expected a single explanatory warning");
  assertStringIncludes(lines[0], "unavailable");
  assertStringIncludes(lines[0], "discovery=unavailable");
});

Deno.test("signalDiscoveryMemoryPressure: monitoring disabled leaves the analysis alone", () => {
  const deps = makeSpyDeps();
  const { logger } = makeRecordingLogger();
  const result = signalDiscoveryMemoryPressure(
    config({ enabled: false }),
    logger,
    deps,
    fixedProvider({ heapUsed: 99 * MB, heapTotal: 100 * MB, rss: 9000 * MB }),
  );
  assertEquals(result.shouldCancel, false);
  assertEquals(deps.cancelCalls, 0);
});
