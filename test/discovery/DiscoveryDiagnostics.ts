/**
 * Tests for the discovery diagnostics aggregation module.
 *
 * Verifies per-changeType success/failure rate tracking and
 * summary table generation for discovery candidate evaluation.
 *
 * Part of #1735.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { EvaluationTaskResult } from "@discovery/DiscoveryRunnerEvaluation.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import {
  aggregateDiscoveryDiagnostics,
  type DiscoveryDiagnosticsEntry,
  formatDiagnosticsTable,
} from "@discovery/DiscoveryDiagnostics.ts";
import { makeSimpleCreature } from "../fixtures/SimpleCreatures.ts";

/** Helper to build a minimal candidate with a given changeType. */
function fakeCandidate(
  changeType: string,
): DiscoveryCandidate {
  return {
    creature: makeSimpleCreature(),
    change: {
      type: changeType as DiscoveryCandidate["change"]["type"],
      description: `Test ${changeType}`,
    },
  };
}

/** Helper to build an EvaluationTaskResult for a candidate. */
function makeResult(
  changeType: string,
  score: number,
  error: number,
): EvaluationTaskResult {
  return {
    kind: "candidate",
    candidate: fakeCandidate(changeType),
    error,
    score,
  };
}

Deno.test("aggregateDiscoveryDiagnostics returns empty map for no candidates", () => {
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: 0.8 },
  ];
  const diagnostics = aggregateDiscoveryDiagnostics(results, 0.8);
  assertEquals(diagnostics.size, 0);
});

Deno.test("aggregateDiscoveryDiagnostics counts single success", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
    makeResult("add-neurons", 0.7, 0.3), // improved
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  assertEquals(diagnostics.size, 1);

  const entry = diagnostics.get("add-neurons")!;
  assertEquals(entry.evaluated, 1);
  assertEquals(entry.improved, 1);
  assertAlmostEquals(entry.successRate, 100.0);
  assertAlmostEquals(entry.averageScoreDelta, 0.2);
});

Deno.test("aggregateDiscoveryDiagnostics counts single failure", () => {
  const originalScore = 0.8;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.2, score: originalScore },
    makeResult("change-squash", 0.6, 0.4), // worse
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  const entry = diagnostics.get("change-squash")!;
  assertEquals(entry.evaluated, 1);
  assertEquals(entry.improved, 0);
  assertAlmostEquals(entry.successRate, 0.0);
  assertEquals(entry.averageScoreDelta, 0); // no successes => 0
});

Deno.test("aggregateDiscoveryDiagnostics handles mixed results for same type", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
    makeResult("add-synapses", 0.7, 0.3), // improved by 0.2
    makeResult("add-synapses", 0.4, 0.6), // worse
    makeResult("add-synapses", 0.9, 0.1), // improved by 0.4
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  const entry = diagnostics.get("add-synapses")!;
  assertEquals(entry.evaluated, 3);
  assertEquals(entry.improved, 2);
  assertAlmostEquals(entry.successRate, 66.667, 0.01);
  // Average score delta for successes: (0.2 + 0.4) / 2 = 0.3
  assertAlmostEquals(entry.averageScoreDelta, 0.3);
});

Deno.test("aggregateDiscoveryDiagnostics tracks multiple change types independently", () => {
  const originalScore = 1.0;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.1, score: originalScore },
    makeResult("add-neurons", 1.2, 0.08), // improved
    makeResult("remove-synapse", 0.9, 0.12), // worse
    makeResult("change-squash", 1.1, 0.09), // improved
    makeResult("change-squash", 0.8, 0.15), // worse
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  assertEquals(diagnostics.size, 3);

  const neurons = diagnostics.get("add-neurons")!;
  assertEquals(neurons.evaluated, 1);
  assertEquals(neurons.improved, 1);
  assertAlmostEquals(neurons.successRate, 100.0);

  const synapse = diagnostics.get("remove-synapse")!;
  assertEquals(synapse.evaluated, 1);
  assertEquals(synapse.improved, 0);
  assertAlmostEquals(synapse.successRate, 0.0);

  const squash = diagnostics.get("change-squash")!;
  assertEquals(squash.evaluated, 2);
  assertEquals(squash.improved, 1);
  assertAlmostEquals(squash.successRate, 50.0);
});

Deno.test("aggregateDiscoveryDiagnostics ignores original results", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  assertEquals(diagnostics.size, 0);
});

Deno.test("aggregateDiscoveryDiagnostics handles candidate with equal score as failure", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
    makeResult("add-neurons", 0.5, 0.5), // equal = not improved
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  const entry = diagnostics.get("add-neurons")!;
  assertEquals(entry.improved, 0);
  assertAlmostEquals(entry.successRate, 0.0);
});

Deno.test("formatDiagnosticsTable returns empty string for empty diagnostics", () => {
  const diagnostics = new Map<string, DiscoveryDiagnosticsEntry>();
  const table = formatDiagnosticsTable(diagnostics);
  assertEquals(table, "");
});

Deno.test("formatDiagnosticsTable formats single entry", () => {
  const diagnostics = new Map<string, DiscoveryDiagnosticsEntry>();
  diagnostics.set("add-neurons", {
    evaluated: 3,
    improved: 2,
    successRate: 66.67,
    averageScoreDelta: 0.15,
  });

  const table = formatDiagnosticsTable(diagnostics);
  assert(table.includes("add-neurons"));
  assert(table.includes("3"));
  assert(table.includes("2"));
  assert(table.includes("66.7%"));
});

Deno.test("formatDiagnosticsTable includes all change types", () => {
  const diagnostics = new Map<string, DiscoveryDiagnosticsEntry>();
  diagnostics.set("add-neurons", {
    evaluated: 2,
    improved: 1,
    successRate: 50.0,
    averageScoreDelta: 0.1,
  });
  diagnostics.set("remove-synapse", {
    evaluated: 1,
    improved: 0,
    successRate: 0.0,
    averageScoreDelta: 0,
  });

  const table = formatDiagnosticsTable(diagnostics);
  assert(table.includes("add-neurons"));
  assert(table.includes("remove-synapse"));
});

Deno.test("aggregateDiscoveryDiagnostics handles combo types", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
    makeResult("combo-successful", 0.8, 0.2),
    makeResult("combo-all", 0.4, 0.6),
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  assertEquals(diagnostics.size, 2);

  const comboSuccessful = diagnostics.get("combo-successful")!;
  assertEquals(comboSuccessful.evaluated, 1);
  assertEquals(comboSuccessful.improved, 1);

  const comboAll = diagnostics.get("combo-all")!;
  assertEquals(comboAll.evaluated, 1);
  assertEquals(comboAll.improved, 0);
});

Deno.test("aggregateDiscoveryDiagnostics skips candidates without change type", () => {
  const originalScore = 0.5;
  const results: EvaluationTaskResult[] = [
    { kind: "original", error: 0.5, score: originalScore },
    {
      kind: "candidate",
      candidate: undefined,
      error: 0.3,
      score: 0.7,
    },
  ];

  const diagnostics = aggregateDiscoveryDiagnostics(results, originalScore);
  assertEquals(diagnostics.size, 0);
});
