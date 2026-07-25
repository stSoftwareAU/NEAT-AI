/**
 * Integration guard for the heap-abort signal across the discovery wire path
 * (Issue #3027, the integration-guard item of #3022).
 *
 * ## What this pins down
 *
 * The `heapAbortedAtExtensionBoundary` signal originates at the
 * analysis-extension boundary in `DataRecorder` and travels:
 *
 * ```
 * resolveHeapAbortBoundary  (DataRecorder boundary, AnalysisExtensionBoundary.ts)
 *   -> buildDiscoverResponsePayload  (worker serialization, WorkerProcessor.ts)
 *     -> chooseDiscoveryCompleteOutcome  (outcome map, DiscoveryOutcome.ts)
 * ```
 *
 * The existing unit tests cover each hop in isolation. This test composes the
 * *real* production functions for every hop so a regression at any seam — the
 * guard, the wire payload, or the outcome map — is caught end-to-end, not just
 * in-process. It is the structural defence that the #3022 false positive
 * (`heap_critical_skip` emitted for a worker-default-heap-but-budget-has-
 * headroom iteration) cannot silently return.
 *
 * The only thing mocked is the recording phase: the heap sample is injected via
 * the same `_setHeapGuardProviderForTests` seam `DataRecorder` reads through, so
 * no real `Deno.memoryUsage()` or analysis loop runs.
 *
 * ## The explicit rule (encoded as assertions, not comments)
 *
 * Either the serialized worker heap sample is below CRITICAL at the boundary,
 * **or** the guard does not abort while configured native-budget headroom
 * exists. In both legs the wire payload's `heapAbortedAtExtensionBoundary` is
 * unset and the outcome is not `"heap_critical_skip"`. The negative leg proves
 * a genuine budget-exhaustion abort still sets the field and yields
 * `"heap_critical_skip"`.
 */
import { assert, assertEquals } from "@std/assert";
import {
  _setHeapGuardProviderForTests,
  type HeapGuardSample,
  sampleHeapPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import { resolveHeapAbortBoundary } from "@architecture/ErrorGuidedStructuralEvolution/AnalysisExtensionBoundary.ts";
import { buildDiscoverResponsePayload } from "@multithreading/workers/WorkerProcessor.ts";
import { chooseDiscoveryCompleteOutcome } from "@neat/DiscoveryOutcome.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

const MB = 1024 * 1024;

/**
 * Worker-shaped post-recording heap sample on the small default ~269 MB worker
 * V8 heap: ≈231 MB used (≈86%, above the 0.85 critical threshold). The native
 * RSS sits well within a generous budget — the GRQ-23 false-positive shape.
 */
const WORKER_DEFAULT_HEAP_TOTAL = Math.round(269 * MB);
const POST_RECORDING_HEAP_USED = Math.round(231 * MB);

/** Native (RSS) budget with ample headroom for the worker-default case. */
const NATIVE_BUDGET = Math.round(20 * 1024 * MB); // ~20 GB host
const HEALTHY_RSS = Math.round(8 * 1024 * MB); // ~8 GB, within budget

function makeRecordingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args) => warnings.push(args.join(" ")),
    error: () => {},
  };
  return { logger, warnings };
}

function fixedProvider(sample: MemoryUsageSample): () => MemoryUsageSample {
  return () => sample;
}

/** Config that makes the guard off-heap (RSS) aware, as on the GRQ host. */
function budgetAwareConfig(): RequiredMemoryConfig {
  return { ...DEFAULT_MEMORY_CONFIG, nativeBudgetBytes: NATIVE_BUDGET };
}

/**
 * Drive the full record→boundary→wire→outcome pipeline with an injected heap
 * sample, returning the wire payload's signal and the resolved outcome. Uses
 * the module seam exactly the way `DataRecorder` reads the heap, so no provider
 * is threaded through `resolveHeapAbortBoundary` (production read path).
 */
function runBoundaryPipeline(
  sample: MemoryUsageSample,
  memoryConfig: RequiredMemoryConfig,
): {
  abortResult: DiscoverResult | null;
  wireSignal: boolean | undefined;
  outcome: string;
} {
  try {
    _setHeapGuardProviderForTests(fixedProvider(sample));
    const { logger } = makeRecordingLogger();

    // Hop 1: DataRecorder boundary decision (real production function).
    const abortResult = resolveHeapAbortBoundary(
      "grq-int",
      memoryConfig,
      logger,
    );

    // A `null` decision means analysis continues; DataRecorder then returns a
    // happy-path result carrying no heap-abort flag. Model that wire shape.
    const wireSource: DiscoverResult = abortResult ?? {
      ID: "grq-int",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    // Hop 2: cross the worker serialization boundary (real production function).
    const payload = buildDiscoverResponsePayload(wireSource);

    // Hop 3: map the serialized signal to a discovery_complete outcome.
    const outcome = chooseDiscoveryCompleteOutcome({
      heapAbortedAtExtensionBoundary: payload.heapAbortedAtExtensionBoundary,
    });

    return {
      abortResult,
      wireSignal: payload.heapAbortedAtExtensionBoundary,
      outcome,
    };
  } finally {
    _setHeapGuardProviderForTests(undefined);
  }
}

Deno.test(
  "DiscoveryHeapAbortBoundaryIntegration: worker-default-heap with native-budget headroom does NOT emit heap_critical_skip across the wire",
  () => {
    const config = budgetAwareConfig();
    const sample: MemoryUsageSample = {
      heapUsed: POST_RECORDING_HEAP_USED,
      heapTotal: WORKER_DEFAULT_HEAP_TOTAL,
      rss: HEALTHY_RSS,
      external: Math.round(47 * MB),
    };

    // The explicit #3022 rule, encoded as an assertion: EITHER the serialized
    // worker heap sample is below CRITICAL at the boundary, OR the guard does
    // not abort while configured budget headroom exists.
    //
    // Sample the *injected* worker-default heap, not the live process. Passing
    // the provider explicitly keeps this deterministic: since Issue #3433/#3410
    // the usage fraction divides by the real V8 old-space *limit* (~GBs), so
    // sampling `Deno.memoryUsage()` here would read far below CRITICAL and the
    // line-171 assertion — which asserts the worker-default fraction IS
    // critical — would fail non-deterministically on the runner's live heap.
    const guardSample: HeapGuardSample = sampleHeapPressure(
      config,
      fixedProvider(sample),
    );
    const belowCritical = guardSample.usageFraction < config.criticalThreshold;
    const budgetHeadroom = config.nativeBudgetBytes > 0 &&
      guardSample.rss <= config.nativeBudgetBytes;
    assert(
      belowCritical || budgetHeadroom,
      "boundary rule violated: heap is CRITICAL AND no native-budget headroom",
    );

    const { abortResult, wireSignal, outcome } = runBoundaryPipeline(
      sample,
      config,
    );

    // Here the V8 fraction IS critical (proving the off-heap headroom leg is
    // what keeps the run alive, not a sub-critical sample).
    assert(
      guardSample.usageFraction >= config.criticalThreshold,
      "expected the worker-default V8 fraction to be CRITICAL for this case",
    );
    assertEquals(guardSample.pressureLevel, "critical");

    // No abort, no signal on the wire, and not a heap_critical_skip outcome.
    assertEquals(abortResult, null);
    assertEquals(wireSignal, undefined);
    assertEquals(outcome, "no_change");
    assert(
      outcome !== "heap_critical_skip",
      "false positive: healthy budget-headroom iteration mislabelled",
    );
  },
);

Deno.test(
  "DiscoveryHeapAbortBoundaryIntegration: genuine budget exhaustion still sets the field and yields heap_critical_skip across the wire",
  () => {
    const config = budgetAwareConfig();
    // Same CRITICAL V8 fraction, but RSS now exceeds the native budget — a
    // genuine OOM that must never be masked.
    const sample: MemoryUsageSample = {
      heapUsed: POST_RECORDING_HEAP_USED,
      heapTotal: WORKER_DEFAULT_HEAP_TOTAL,
      rss: NATIVE_BUDGET + Math.round(512 * MB),
      external: Math.round(47 * MB),
    };

    const { abortResult, wireSignal, outcome } = runBoundaryPipeline(
      sample,
      config,
    );

    assert(abortResult !== null, "expected a genuine budget-exhaustion abort");
    assertEquals(abortResult?.heapAbortedAtExtensionBoundary, true);
    // Candidate fields stay undefined — analysis never ran.
    assertEquals(abortResult?.addHelpfulSynapses, undefined);
    assertEquals(abortResult?.candidateSquashes, undefined);

    // Signal survives the worker serialization boundary and drives the outcome.
    assertEquals(wireSignal, true);
    assertEquals(outcome, "heap_critical_skip");
  },
);

Deno.test(
  "DiscoveryHeapAbortBoundaryIntegration: legacy V8-only config (no native budget) still aborts on CRITICAL across the wire",
  () => {
    // nativeBudgetBytes = 0 → off-heap awareness disabled → legacy behaviour:
    // a CRITICAL worker-default V8 fraction aborts and yields heap_critical_skip.
    const sample: MemoryUsageSample = {
      heapUsed: POST_RECORDING_HEAP_USED,
      heapTotal: WORKER_DEFAULT_HEAP_TOTAL,
      rss: HEALTHY_RSS,
      external: Math.round(47 * MB),
    };

    const { abortResult, wireSignal, outcome } = runBoundaryPipeline(
      sample,
      DEFAULT_MEMORY_CONFIG, // nativeBudgetBytes = 0
    );

    assert(abortResult !== null, "legacy config must still abort on CRITICAL");
    assertEquals(wireSignal, true);
    assertEquals(outcome, "heap_critical_skip");
  },
);
