/**
 * Tests for the per-operator mutation log line (Issue #3971).
 *
 * The line rides the existing verbose per-generation diagnostics, so it has to
 * stay parseable by eye: one segment per operator with activity, the
 * outcome-joined depth buckets when there are any, and the attribution summary
 * that states the multi-operator ambiguity in numbers.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { MULTI_OPERATOR_ATTRIBUTION_NOTE } from "@neat/MutationOperatorReport.ts";
import type {
  MutationDepthBucket,
  MutationOperatorReport,
  MutationOperatorSummary,
} from "@neat/MutationOperatorReport.ts";
import { formatMutationOperatorReport } from "@neat/MutationOperatorLog.ts";

function buckets(
  overrides: Partial<Record<MutationDepthBucket, number>> = {},
): Record<MutationDepthBucket, number> {
  return {
    "input-adjacent": 0,
    "mid": 0,
    "output-adjacent": 0,
    "unknown": 0,
    ...overrides,
  };
}

function summary(
  overrides: Partial<MutationOperatorSummary> = {},
): MutationOperatorSummary {
  return {
    proposed: 0,
    noChange: 0,
    applied: 0,
    reverted: 0,
    mcmcAccepted: 0,
    mcmcRejected: 0,
    evaluated: 0,
    accepted: 0,
    rejected: 0,
    evaluationMs: 0,
    deltaUnavailable: 0,
    depthBuckets: buckets(),
    acceptedDepthBuckets: buckets(),
    rejectedDepthBuckets: buckets(),
    soleAttributed: 0,
    coAttributed: 0,
    ...overrides,
  };
}

function report(
  operators: Record<string, MutationOperatorSummary>,
  attribution: Partial<MutationOperatorReport["attribution"]> = {},
): MutationOperatorReport {
  return {
    operators,
    mcmc: { proposed: 4, accepted: 1, rejected: 3 },
    attribution: {
      resolvedOffspring: 2,
      multiOperatorOffspring: 1,
      discardedOffspring: 0,
      evaluationMs: 12,
      note: MULTI_OPERATOR_ATTRIBUTION_NOTE,
      ...attribution,
    },
  };
}

Deno.test("formatMutationOperatorReport: a generation with no activity produces no line", () => {
  assertEquals(formatMutationOperatorReport(report({})), undefined);
  // An operator row with nothing in it is not worth a segment either.
  assertEquals(
    formatMutationOperatorReport(report({ ADD_NODE: summary() })),
    undefined,
  );
});

Deno.test("formatMutationOperatorReport: reports counters, delta and depth for an operator", () => {
  const line = formatMutationOperatorReport(report({
    ADD_NODE: summary({
      proposed: 5,
      noChange: 1,
      applied: 4,
      reverted: 1,
      evaluated: 3,
      accepted: 1,
      rejected: 2,
      evaluationMs: 120.4,
      scoreDelta: { count: 3, min: -0.5, median: 0.25, max: 1 },
      depthBuckets: buckets({ "input-adjacent": 4 }),
      acceptedDepthBuckets: buckets({ "input-adjacent": 1 }),
      rejectedDepthBuckets: buckets({ "mid": 2 }),
      soleAttributed: 2,
      coAttributed: 1,
    }),
  }));

  assert(line, "a line was produced");
  assertStringIncludes(line, "[MutationOps] ADD_NODE");
  assertStringIncludes(line, "proposed=5 noChange=1 applied=4 reverted=1");
  assertStringIncludes(line, "evaluated=3 accepted=1 rejected=2");
  assertStringIncludes(line, "evalMs=120");
  assertStringIncludes(line, "delta[n=3 min=-0.5000 med=0.2500 max=1.0000]");
  assertStringIncludes(line, "depth[in=4 mid=0 out=0 ?=0]");
  assertStringIncludes(line, "depthAccepted[in=1 mid=0 out=0 ?=0]");
  assertStringIncludes(line, "depthRejected[in=0 mid=2 out=0 ?=0]");
  assertStringIncludes(line, "attribution[sole=2 co=1]");
  assertStringIncludes(
    line,
    "resolved=2 multiOperator=1 discarded=0 evalMs=12 mcmc=1/4",
  );
});

Deno.test("formatMutationOperatorReport: omits outcome depth buckets when there is no outcome yet", () => {
  const line = formatMutationOperatorReport(report({
    MOD_WEIGHT: summary({
      proposed: 2,
      applied: 2,
      depthBuckets: buckets({ unknown: 2 }),
    }),
  }));

  assert(line);
  assertStringIncludes(line, "depth[in=0 mid=0 out=0 ?=2]");
  assertEquals(line.includes("depthAccepted"), false);
  assertEquals(line.includes("depthRejected"), false);
});
