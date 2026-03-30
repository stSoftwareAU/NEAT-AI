import { logReplaySummary } from "@neat/NeatScheduling.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { DiscoveryReplayDirResult } from "@neat/DiscoveryReplayQueue.ts";

/**
 * Unit tests for NeatScheduling.logReplaySummary() — replay result logging.
 *
 * Issue #1749: Verify that logReplaySummary correctly handles various
 * replay results including improvements, no improvements, pruning,
 * timeouts, and verbose mode logging.
 */

/** Helper to create a minimal NeatConfig for testing. */
function createTestConfig(verbose = false) {
  return createNeatConfig({ verbose });
}

/** Helper to create a base DiscoveryReplayDirResult. */
function createBaseResult(
  overrides?: Partial<DiscoveryReplayDirResult>,
): DiscoveryReplayDirResult {
  return {
    original: { error: 0.5, score: -0.5 },
    evaluatedSingles: 0,
    evaluatedCombos: 0,
    pruned: 0,
    skippedAlreadyApplied: 0,
    skippedNotApplicable: 0,
    ...overrides,
  };
}

// ============================================================================
// No Improvement
// ============================================================================

Deno.test("logReplaySummary: handles result with no improvement", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 5,
    evaluatedCombos: 2,
  });

  // Should not throw
  logReplaySummary(config, result);
});

// ============================================================================
// With Improvement
// ============================================================================

Deno.test("logReplaySummary: handles result with improvement", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 3,
    evaluatedCombos: 1,
    improvement: {
      key: "test-key",
      changeType: "add_synapse",
      error: 0.3,
      score: -0.3,
      scoreDelta: 0.2,
      message: "Improved by adding synapse",
      creature: {},
    },
  });

  logReplaySummary(config, result);
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("logReplaySummary: handles zero evaluated entries", () => {
  const config = createTestConfig();
  const result = createBaseResult();

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: handles pruned entries", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 2,
    pruned: 5,
  });

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: handles skipped already-applied entries", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 1,
    skippedAlreadyApplied: 3,
  });

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: handles skipped not-applicable entries", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 1,
    skippedNotApplicable: 4,
  });

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: handles timed-out result", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 3,
    timedOut: true,
  });

  logReplaySummary(config, result);
});

// ============================================================================
// Verbose Mode
// ============================================================================

Deno.test("logReplaySummary: verbose mode with successful candidates", () => {
  const config = createTestConfig(true);
  const result = createBaseResult({
    evaluatedSingles: 5,
    improvement: {
      key: "verbose-key",
      changeType: "remove_synapse",
      error: 0.2,
      score: -0.2,
      scoreDelta: 0.3,
      message: "Improved by removing synapse",
      creature: {},
    },
    evaluations: [
      {
        key: "eval-1",
        kind: "single",
        changeType: "add_synapse",
        description: "Added synapse 1->3",
        improved: true,
        score: -0.35,
        error: 0.35,
        scoreDelta: 0.15,
      },
      {
        key: "eval-2",
        kind: "combo",
        changeType: "multi_edit",
        description: "Combo edit",
        improved: true,
        score: -0.25,
        error: 0.25,
        scoreDelta: 0.25,
      },
      {
        key: "original",
        kind: "original",
        changeType: "baseline",
        description: "Original baseline",
        improved: false,
        score: -0.5,
        error: 0.5,
        scoreDelta: 0,
      },
    ],
  });

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: verbose mode with no successful candidates", () => {
  const config = createTestConfig(true);
  const result = createBaseResult({
    evaluatedSingles: 3,
    evaluations: [
      {
        key: "eval-1",
        kind: "single",
        changeType: "add_synapse",
        description: "Added synapse",
        improved: false,
        score: -0.55,
        error: 0.55,
        scoreDelta: -0.05,
      },
    ],
  });

  logReplaySummary(config, result);
});

Deno.test("logReplaySummary: verbose mode with empty evaluations array", () => {
  const config = createTestConfig(true);
  const result = createBaseResult({
    evaluatedSingles: 0,
    evaluations: [],
  });

  logReplaySummary(config, result);
});

// ============================================================================
// All Summary Parts Present
// ============================================================================

Deno.test("logReplaySummary: handles all summary parts at once", () => {
  const config = createTestConfig();
  const result = createBaseResult({
    evaluatedSingles: 3,
    evaluatedCombos: 2,
    pruned: 1,
    skippedAlreadyApplied: 4,
    skippedNotApplicable: 2,
    timedOut: true,
    improvement: {
      key: "full-test",
      changeType: "modify_weight",
      error: 0.15,
      score: -0.15,
      scoreDelta: 0.35,
      message: "Full test improvement",
      creature: {},
    },
  });

  logReplaySummary(config, result);
});
