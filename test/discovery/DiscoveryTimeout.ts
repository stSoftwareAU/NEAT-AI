import { assert, assertEquals } from "@std/assert";
import {
  allocateDiscoveryTimeouts,
  calculateDiscoveryTimeout,
  DEFAULT_DISCOVERY_TIMEOUT_BOUNDS,
  DISCOVERY_MIN_PHASE_MINUTES,
  GRQ_TASK_DEADLINE_EPOCH_ENV,
  GRQ_TASK_MAX_SECONDS_ENV,
  remainingTaskBudgetMinutes,
  type TaskBudgetEnv,
} from "@discovery/DiscoveryTimeout.ts";

Deno.test("calculateDiscoveryTimeout - minimal creature returns near-minimum timeout", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 3, // 2 input + 1 output = minimal
    synapseCount: 2,
  });
  assert(
    timeout >= DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Minimal creature timeout should be at least the minimum",
  );
  assert(
    timeout < DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes * 0.5,
    `Minimal creature timeout (${timeout}) should be well below half the maximum`,
  );
});

Deno.test("calculateDiscoveryTimeout - complex creature returns higher timeout", () => {
  const simpleTimeout = calculateDiscoveryTimeout({
    neuronCount: 5,
    synapseCount: 4,
  });
  const complexTimeout = calculateDiscoveryTimeout({
    neuronCount: 100,
    synapseCount: 500,
  });

  assert(
    complexTimeout > simpleTimeout,
    `Complex creature timeout (${complexTimeout}) should exceed simple creature timeout (${simpleTimeout})`,
  );
});

Deno.test("calculateDiscoveryTimeout - very complex creature is capped at maximum", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 10_000,
    synapseCount: 100_000,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes,
    "Very complex creature should be capped at maximum timeout",
  );
});

Deno.test("calculateDiscoveryTimeout - zero neurons/synapses returns minimum", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 0,
    synapseCount: 0,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Zero-size creature should get minimum timeout",
  );
});

Deno.test("calculateDiscoveryTimeout - scales logarithmically", () => {
  // Doubling complexity should NOT double timeout (logarithmic, not linear)
  const t1 = calculateDiscoveryTimeout({
    neuronCount: 10,
    synapseCount: 20,
  });
  const t2 = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 40,
  });
  const t4 = calculateDiscoveryTimeout({
    neuronCount: 40,
    synapseCount: 80,
  });

  // The ratio of increase should diminish (logarithmic property)
  const increase1to2 = t2 - t1;
  const increase2to4 = t4 - t2;

  assert(
    increase2to4 <= increase1to2 * 1.5, // Allow small tolerance
    `Logarithmic scaling: doubling input again should yield diminishing returns. ` +
      `First increase: ${increase1to2.toFixed(4)}, second increase: ${
        increase2to4.toFixed(4)
      }`,
  );
});

Deno.test("calculateDiscoveryTimeout - custom bounds are respected", () => {
  const customMin = 2;
  const customMax = 5;

  const minTimeout = calculateDiscoveryTimeout(
    { neuronCount: 1, synapseCount: 0 },
    { minTimeoutMinutes: customMin, maxTimeoutMinutes: customMax },
  );
  assertEquals(minTimeout, customMin, "Should respect custom minimum");

  const maxTimeout = calculateDiscoveryTimeout(
    { neuronCount: 10_000, synapseCount: 100_000 },
    { minTimeoutMinutes: customMin, maxTimeoutMinutes: customMax },
  );
  assertEquals(maxTimeout, customMax, "Should respect custom maximum");
});

Deno.test("calculateDiscoveryTimeout - more synapses increases timeout", () => {
  const fewSynapses = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 10,
  });
  const manySynapses = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 200,
  });

  assert(
    manySynapses >= fewSynapses,
    `More synapses (${manySynapses}) should yield >= timeout than fewer (${fewSynapses})`,
  );
});

Deno.test("calculateDiscoveryTimeout - more neurons increases timeout", () => {
  const fewNeurons = calculateDiscoveryTimeout({
    neuronCount: 5,
    synapseCount: 20,
  });
  const manyNeurons = calculateDiscoveryTimeout({
    neuronCount: 50,
    synapseCount: 20,
  });

  assert(
    manyNeurons >= fewNeurons,
    `More neurons (${manyNeurons}) should yield >= timeout than fewer (${fewNeurons})`,
  );
});

Deno.test("calculateDiscoveryTimeout - default bounds are sensible", () => {
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes > 0,
    "Minimum timeout must be positive",
  );
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes >
      DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Maximum timeout must exceed minimum",
  );
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes <= 10,
    "Maximum timeout should not exceed 10 minutes",
  );
});

Deno.test("calculateDiscoveryTimeout - negative inputs treated as zero", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: -5,
    synapseCount: -10,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Negative inputs should be treated as zero complexity",
  );
});

// ============================================================================
// Issue #2432: allocateDiscoveryTimeouts — hard wall-clock ceiling
// ============================================================================

Deno.test("allocateDiscoveryTimeouts - never exceeds wall-clock budget", () => {
  // Caller asks for 9 minutes total. Configured caps (record=5, analysis=10)
  // would historically have allowed 5+10=15 minutes per discovery.
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 9,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 10,
  });
  assert(
    a.totalMinutes <= 9 + 1e-9,
    `record(${a.recordMinutes})+analysis(${a.analysisMinutes})=${a.totalMinutes} ` +
      `must not exceed wall-clock 9m`,
  );
  assert(a.recordMinutes > 0, "Record phase should still get some time");
  assert(a.analysisMinutes > 0, "Analysis phase should still get some time");
});

Deno.test("allocateDiscoveryTimeouts - clamps recording by adaptive ceiling", () => {
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 60,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 3,
  });
  assertEquals(
    a.recordMinutes,
    3,
    "Adaptive ceiling should bound recording",
  );
  assert(
    a.analysisMinutes <= 10 + 1e-9,
    `Analysis must not exceed configured ${10}m, got ${a.analysisMinutes}`,
  );
});

Deno.test("allocateDiscoveryTimeouts - generous budget honours configured caps", () => {
  // 60m wall-clock is far more than the configured caps — each phase should
  // be limited to its configured cap.
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 60,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 10,
  });
  assertEquals(a.recordMinutes, 5, "Recording should respect configured cap");
  assertEquals(
    a.analysisMinutes,
    10,
    "Analysis should respect configured cap",
  );
});

Deno.test("allocateDiscoveryTimeouts - tight budget keeps both phases above min", () => {
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 2,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 10,
  });
  assert(
    a.totalMinutes <= 2 + 1e-9,
    `total ${a.totalMinutes} must not exceed 2m`,
  );
  assert(
    a.recordMinutes >= DISCOVERY_MIN_PHASE_MINUTES,
    `recording ${a.recordMinutes} should be at least ${DISCOVERY_MIN_PHASE_MINUTES}m`,
  );
  assert(
    a.analysisMinutes >= DISCOVERY_MIN_PHASE_MINUTES,
    `analysis ${a.analysisMinutes} should be at least ${DISCOVERY_MIN_PHASE_MINUTES}m`,
  );
});

Deno.test("allocateDiscoveryTimeouts - zero wall-clock budget yields zero allocation", () => {
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 0,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 10,
  });
  assertEquals(a.totalMinutes, 0);
  assertEquals(a.recordMinutes, 0);
  assertEquals(a.analysisMinutes, 0);
});

Deno.test("allocateDiscoveryTimeouts - negative inputs are clamped to zero", () => {
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: -5,
    configuredRecordMinutes: -1,
    configuredAnalysisMinutes: -3,
    adaptiveRecordMinutes: -2,
  });
  assertEquals(a.totalMinutes, 0);
});

Deno.test("allocateDiscoveryTimeouts - sub-minimum budget splits proportionally", () => {
  // With < 2 * MIN_PHASE_MINUTES wall-clock, allocation halves between phases
  // while still respecting that the total never exceeds wallClockMinutes.
  const a = allocateDiscoveryTimeouts({
    wallClockMinutes: 0.6,
    configuredRecordMinutes: 5,
    configuredAnalysisMinutes: 10,
    adaptiveRecordMinutes: 10,
  });
  assert(
    a.totalMinutes <= 0.6 + 1e-9,
    `total ${a.totalMinutes} must not exceed 0.6m`,
  );
  assert(
    a.recordMinutes > 0 && a.analysisMinutes > 0,
    "Both phases should receive some time when wall-clock > 0",
  );
});

// ============================================================================
// GRQ #4141: remainingTaskBudgetMinutes — env-derived remaining budget
// ============================================================================

function fakeEnv(values: Record<string, string | undefined>): TaskBudgetEnv {
  return {
    get: (key: string) => values[key],
  };
}

Deno.test("remainingTaskBudgetMinutes - unset env is unchanged (undefined)", () => {
  assertEquals(
    remainingTaskBudgetMinutes(fakeEnv({}), 1_000_000),
    undefined,
    "No GRQ deadline exported → callers keep their inferred budget",
  );
  assertEquals(
    remainingTaskBudgetMinutes(
      fakeEnv({
        [GRQ_TASK_DEADLINE_EPOCH_ENV]: "",
        [GRQ_TASK_MAX_SECONDS_ENV]: "",
      }),
      1_000_000,
    ),
    undefined,
  );
});

Deno.test("remainingTaskBudgetMinutes - env-derived remaining matches deadline − now", () => {
  const nowSeconds = 1_000_000;
  const remainingSeconds = 600;
  const deadline = nowSeconds + remainingSeconds;
  const remaining = remainingTaskBudgetMinutes(
    fakeEnv({
      [GRQ_TASK_DEADLINE_EPOCH_ENV]: String(deadline),
      [GRQ_TASK_MAX_SECONDS_ENV]: String(3 * 3600),
    }),
    nowSeconds,
  );
  assertEquals(remaining, remainingSeconds / 60);
});

Deno.test("remainingTaskBudgetMinutes - remaining is clamped by GRQ_TASK_MAX_SECONDS", () => {
  const nowSeconds = 1_000_000;
  const remaining = remainingTaskBudgetMinutes(
    fakeEnv({
      [GRQ_TASK_DEADLINE_EPOCH_ENV]: String(nowSeconds + 10_000),
      [GRQ_TASK_MAX_SECONDS_ENV]: "120",
    }),
    nowSeconds,
  );
  assertEquals(remaining, 2);
});

Deno.test("remainingTaskBudgetMinutes - past deadline yields zero, not negative", () => {
  const remaining = remainingTaskBudgetMinutes(
    fakeEnv({
      [GRQ_TASK_DEADLINE_EPOCH_ENV]: "500",
      [GRQ_TASK_MAX_SECONDS_ENV]: "10800",
    }),
    1_000,
  );
  assertEquals(remaining, 0);
});

Deno.test("remainingTaskBudgetMinutes - deadline without max seconds still works", () => {
  const remaining = remainingTaskBudgetMinutes(
    fakeEnv({
      [GRQ_TASK_DEADLINE_EPOCH_ENV]: "1300",
    }),
    1000,
  );
  assertEquals(remaining, 5);
});

Deno.test("remainingTaskBudgetMinutes - max seconds alone does not infer a budget", () => {
  assertEquals(
    remainingTaskBudgetMinutes(
      fakeEnv({
        [GRQ_TASK_MAX_SECONDS_ENV]: "10800",
      }),
      1_000,
    ),
    undefined,
    "MAX_SECONDS without a deadline is not enough to derive remaining",
  );
});
