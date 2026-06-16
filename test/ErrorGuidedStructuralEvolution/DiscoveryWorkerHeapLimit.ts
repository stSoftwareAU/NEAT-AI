/**
 * Regression test for the parent/worker V8 heap split at the
 * analysis-extension boundary (Issue #3023, TDD red step of #3022).
 *
 * ## What this pins down
 *
 * On GRQ-23 the **parent** process is sized for a large V8 heap (~7852 MB),
 * but the **discovery worker thread** runs on the default ~269 MB heap. After
 * the recording phase fills that small default worker heap to ≥85%,
 * `checkAnalysisHeapAbort` trips CRITICAL and aborts analysis — even though
 * host RSS / native budget have headroom. The guard logic is correct; the bug
 * is that the worker never receives a heap proportional to the parent's.
 *
 * The existing guard tests
 * (`test/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts`,
 * `AnalysisLoopHeapGuard.ts`) inject abstract `heapUsed / heapTotal` ratios and
 * never model the parent-vs-worker heap split, so the regression escaped. This
 * test models that split with realistic worker-shaped byte counts injected
 * through the `_setHeapGuardProviderForTests` seam — no real
 * `Deno.memoryUsage()` dependence.
 *
 * ## Red → green switch
 *
 * {@link EXPECT_POST_FIX_HEAP_PROPAGATION} is the single, reviewable switch the
 * sibling fix PR flips. While it is `false` (today, on `main`):
 *   - the bug-documenting cases assert the current CRITICAL/abort behaviour, and
 *   - the post-fix contract case is a documented x-fail (skipped).
 * When a sibling fix propagates a worker heap proportional to the parent (or
 * exposes off-heap-budget headroom), flipping this constant to `true` activates
 * the post-fix case, turning the red step green in that PR.
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

/**
 * Single reviewable switch. Flip to `true` in the sibling fix PR that
 * propagates a worker V8 heap proportional to the parent (or wires
 * off-heap-budget headroom into the guard). Flipping it activates the post-fix
 * contract case below, taking this TDD red step to green.
 */
const EXPECT_POST_FIX_HEAP_PROPAGATION = false;

const MB = 1024 * 1024;

/**
 * Worker-shaped heap sample taken just after the recording phase, at the
 * analysis-extension decision point.
 *
 * `heapTotal ≈ 269 MB` is the **default** worker V8 heap observed on GRQ-23;
 * `heapUsed ≈ 231 MB` (≈86%) is the recording phase having filled it past the
 * 85% critical threshold. The parent that spawned the worker is sized for
 * ~7852 MB, so the host has ample headroom the worker cannot see.
 */
const WORKER_DEFAULT_HEAP_TOTAL = Math.round(269 * MB);
const POST_RECORDING_HEAP_USED = Math.round(231 * MB);

/** The parent process heap on GRQ-23 — for contrast, never the worker's. */
const PARENT_HEAP_TOTAL = Math.round(7852 * MB);

/**
 * The post-fix worker heap: a propagated, parent-proportional heap (modelled
 * here as 4096 MB) holding the same ≈231 MB of recorded data, so usage drops
 * well below the critical threshold and analysis is allowed to continue.
 */
const PROPAGATED_WORKER_HEAP_TOTAL = Math.round(4096 * MB);

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

Deno.test("DiscoveryWorkerHeapLimit: default ~269MB worker heap trips CRITICAL at the extension boundary (documents #3022)", () => {
  // Inject the worker-shaped sample via the module-level seam, exactly the way
  // `DataRecorder` reads the heap at the analysis-extension boundary — no
  // provider argument is threaded through, so this exercises the production
  // read path.
  try {
    _setHeapGuardProviderForTests(
      fixedProvider({
        heapUsed: POST_RECORDING_HEAP_USED,
        heapTotal: WORKER_DEFAULT_HEAP_TOTAL,
      }),
    );

    const sample = sampleHeapPressure(DEFAULT_MEMORY_CONFIG);
    // ≈0.86, i.e. above the default 0.85 criticalThreshold.
    assert(
      sample.usageFraction >= DEFAULT_MEMORY_CONFIG.criticalThreshold,
      `expected worker usageFraction ≥ ${DEFAULT_MEMORY_CONFIG.criticalThreshold}, got ${sample.usageFraction}`,
    );
    assertEquals(sample.pressureLevel, "critical");
    assertEquals(isHeapCritical(DEFAULT_MEMORY_CONFIG), true);

    const { logger } = makeRecordingLogger();
    const result = checkAnalysisHeapAbort(
      "grq23-disc",
      DEFAULT_MEMORY_CONFIG,
      logger,
    );

    // Current (buggy) behaviour: the small default worker heap forces an abort.
    assertEquals(result.abort, true);
    assertEquals(result.sample.pressureLevel, "critical");
  } finally {
    _setHeapGuardProviderForTests(undefined);
  }
});

Deno.test("DiscoveryWorkerHeapLimit: the parent ~7852MB heap holding the same data would NOT abort (the split is the cause)", () => {
  // Same recorded bytes, but read against the parent's large heap. This proves
  // the abort is an artefact of the parent/worker heap split, not of real
  // memory pressure: the host has headroom the worker simply cannot see.
  const { logger } = makeRecordingLogger();
  const result = checkAnalysisHeapAbort(
    "grq23-parent",
    DEFAULT_MEMORY_CONFIG,
    logger,
    fixedProvider({
      heapUsed: POST_RECORDING_HEAP_USED,
      heapTotal: PARENT_HEAP_TOTAL,
    }),
  );

  assertEquals(result.abort, false);
  assertEquals(result.sample.pressureLevel, "normal");
});

Deno.test({
  name:
    "DiscoveryWorkerHeapLimit: [post-fix] propagated ~4096MB worker heap keeps analysis running",
  // Documented x-fail until a sibling fix propagates the worker heap. Flip
  // EXPECT_POST_FIX_HEAP_PROPAGATION to `true` in that PR to take this green.
  ignore: !EXPECT_POST_FIX_HEAP_PROPAGATION,
  fn() {
    try {
      _setHeapGuardProviderForTests(
        fixedProvider({
          heapUsed: POST_RECORDING_HEAP_USED,
          heapTotal: PROPAGATED_WORKER_HEAP_TOTAL,
        }),
      );

      const sample = sampleHeapPressure(DEFAULT_MEMORY_CONFIG);
      assert(
        sample.usageFraction < DEFAULT_MEMORY_CONFIG.criticalThreshold,
        `expected propagated-heap usageFraction < ${DEFAULT_MEMORY_CONFIG.criticalThreshold}, got ${sample.usageFraction}`,
      );
      assertEquals(sample.pressureLevel, "normal");

      const { logger } = makeRecordingLogger();
      const result = checkAnalysisHeapAbort(
        "grq23-disc",
        DEFAULT_MEMORY_CONFIG,
        logger,
      );

      // Post-fix contract: with a parent-proportional worker heap the recorded
      // data sits well below the threshold, so analysis is allowed to continue.
      assertEquals(result.abort, false);
      assertEquals(result.sample.pressureLevel, "normal");
    } finally {
      _setHeapGuardProviderForTests(undefined);
    }
  },
});
